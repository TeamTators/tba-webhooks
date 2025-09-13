/* eslint-disable @typescript-eslint/no-explicit-any */
// See /diagrams/redis.drawio for the redis diagram
import { createClient } from 'redis';
import { attemptAsync } from 'ts-utils/check';
import { EventEmitter } from 'ts-utils/event-emitter';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { sleep } from 'ts-utils/sleep';
import { config } from 'dotenv';
config();
const log = (...args) => {
    if (String(process.env.ENVIRONMENT).includes('prod'))
        return;
    // console.log('[Redis]', ...args);
};
const error = (...args) => {
    // console.error('[Redis]', ...args);
};
const warn = (...args) => {
    if (String(process.env.ENVIRONMENT).includes('prod'))
        return;
    // console.warn('[Redis]', ...args);
};
export var Redis;
(function (Redis) {
    Redis.REDIS_NAME = 'default';
    let messageId = -1;
    Redis.clientId = uuid();
    Redis.connect = (name) => {
        Redis.REDIS_NAME = name;
        if (Redis.REDIS_NAME.includes(':')) {
            throw new Error(`Redis name "${Redis.REDIS_NAME}" cannot contain a colon (:) character.`);
        }
        return attemptAsync(async () => {
            if (Redis._sub?.isOpen && Redis._pub?.isOpen && Redis._sub?.isReady && Redis._pub?.isReady) {
                return; // Already connected
            }
            Redis._sub = createClient();
            Redis._pub = createClient();
            Redis._queue = createClient();
            Redis._sub.on('error', (error) => {
                globalEmitter.emit('sub-error', error);
            });
            Redis._sub.on('connect', () => {
                globalEmitter.emit('sub-connect', undefined);
            });
            Redis._sub.on('disconnect', () => {
                globalEmitter.emit('sub-disconnect', undefined);
            });
            Redis._sub.on('reconnect', () => {
                globalEmitter.emit('sub-reconnect', undefined);
            });
            Redis._pub.on('error', (error) => {
                globalEmitter.emit('pub-error', error);
            });
            Redis._pub.on('connect', () => {
                globalEmitter.emit('pub-connect', undefined);
            });
            Redis._pub.on('disconnect', () => {
                globalEmitter.emit('pub-disconnect', undefined);
            });
            Redis._pub.on('reconnect', () => {
                globalEmitter.emit('pub-reconnect', undefined);
            });
            // _sub.on('discovery:you_there', (message) => {
            // 	const [name, id] = message.split(':');
            // 	if (name === REDIS_NAME) {
            // 		_pub?.publish('discovery:im_here', REDIS_NAME + ':' + id);
            // 	}
            // });
            await Promise.all([Redis._sub.connect(), Redis._pub.connect(), Redis._queue.connect()]);
            return new Promise((res, rej) => {
                Redis._sub?.subscribe('discovery:i_am', (message) => {
                    log(`Received discovery:iam message: ${message}`);
                    const [name, instanceId] = message.split(':');
                    log(`Discovery message from instance: ${name} (${instanceId})`, Redis.clientId);
                    if (instanceId === Redis.clientId)
                        return res(); // Ignore our own message and resolve. The pub/sub system is working.
                    Redis._pub?.publish('discovery:welcome', Redis.REDIS_NAME + ':' + instanceId);
                    log(`Discovered instance: ${name} (${instanceId})`);
                });
                Redis._sub?.subscribe('discovery:welcome', (message) => {
                    log(`Received discovery:welcome message: ${message}`);
                    const [name, instanceId] = message.split(':');
                    if (instanceId === Redis.clientId)
                        return; // Ignore our own message
                    log(`Welcome message from instance: ${name} (${instanceId})`);
                    if (name === Redis.REDIS_NAME) {
                        warn(`Another instance of Redis with name "${Redis.REDIS_NAME}" is already running. This may cause conflicts.`);
                        res();
                    }
                });
                Redis._pub?.publish('discovery:i_am', Redis.REDIS_NAME + ':' + Redis.clientId);
                setTimeout(() => {
                    rej(new Error('Redis connection timed out. Please check your Redis server.'));
                }, 1000); // Wait for a second to ensure the discovery messages are processed
            });
        });
    };
    Redis.disconnect = () => {
        return attemptAsync(async () => {
            if (Redis._sub) {
                await Redis._sub.disconnect();
                Redis._sub = undefined;
            }
            if (Redis._pub) {
                await Redis._pub.disconnect();
                Redis._pub = undefined;
            }
        });
    };
    const send = (message) => {
        return attemptAsync(async () => {
            const payload = JSON.stringify({
                event: message.event,
                data: message.data,
                date: message.date.toISOString(),
                id: message.id
            });
            log(`[Redis:${Redis.REDIS_NAME}] Sending message:`, payload);
            Redis._pub?.publish('channel:' + Redis.REDIS_NAME, payload);
        });
    };
    class ListeningService {
        name;
        events;
        static services = new Map();
        em = new EventEmitter();
        on = (event, listener) => this.em.on(event, listener);
        once = (event, listener) => this.em.once(event, listener);
        off = (event, listener) => this.em.off(event, listener);
        emit = (event, payload) => {
            this.em.emit(event, payload);
        };
        constructor(name, events) {
            this.name = name;
            this.events = events;
            if (name === Redis.REDIS_NAME) {
                warn(`Service name "${name}" cannot be the same as the Redis instance name "${Redis.REDIS_NAME}".`);
            }
            if (ListeningService.services.has(this.name)) {
                throw new Error(`Service with name "${this.name}" already exists.`);
            }
            if (!Redis._sub || !Redis._pub) {
                throw new Error(`Redis is not connected. Please call Redis.connect() first.`);
            }
            Redis._sub
                ?.subscribe('channel:' + this.name, (message) => {
                log(`[Redis:${this.name}] Received message:`, message);
                try {
                    const parsed = z
                        .object({
                        event: z.string(),
                        data: z.unknown(),
                        date: z.string().transform((v) => new Date(v)),
                        id: z.number()
                    })
                        .parse(JSON.parse(message));
                    log(`[Redis:${this.name}] Parsed message:`, parsed);
                    if (parsed.event in this.events) {
                        const event = parsed.event;
                        const dataSchema = this.events[event];
                        const data = dataSchema.parse(parsed.data);
                        log(`[Redis:${this.name}] Validated data:`, data);
                        this.emit(event, {
                            data,
                            date: parsed.date,
                            id: parsed.id
                        });
                    }
                }
                catch (e) {
                    error(`[Redis:${this.name}] Error parsing message for service:`, e);
                }
            })
                .then((data) => log(`Subscribed to channel "${this.name}"`))
                .catch((e) => error(`Failed to subscribe to channel "${this.name}":`, e));
            ListeningService.services.set(this.name, this);
        }
    }
    Redis.ListeningService = ListeningService;
    Redis.createListeningService = (name, events) => {
        if (name.includes(':')) {
            throw new Error(`Service name "${name}" cannot contain a colon (:) character.`);
        }
        if (name === Redis.REDIS_NAME) {
            throw new Error(`Service name "${name}" cannot be the same as the Redis instance name "${Redis.REDIS_NAME}".`);
        }
        if (ListeningService.services.has(name)) {
            const s = ListeningService.services.get(name);
            if (s) {
                warn(`Service "${name}" already exists. Returning existing service.`);
                return s;
            }
        }
        return new ListeningService(name, events);
    };
    Redis.emit = (event, data) => {
        return send({
            event,
            data,
            date: new Date(),
            id: messageId++
        });
    };
    const globalEmitter = new EventEmitter();
    Redis.on = globalEmitter.on.bind(globalEmitter);
    Redis.once = globalEmitter.once.bind(globalEmitter);
    Redis.off = globalEmitter.off.bind(globalEmitter);
    Redis.query = (service, event, data, returnType, timeoutMs = 1000) => {
        return attemptAsync(async () => {
            const requestId = uuid();
            const responseChannel = `response:${service}:${requestId}`;
            const queryChannel = `query:${service}:${event}`;
            const responsePromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    Redis._sub?.unsubscribe(responseChannel);
                    reject(new Error(`Request timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                const ondata = (message) => {
                    try {
                        const parsed = z
                            .object({
                            data: z.unknown(),
                            date: z.string().transform((v) => new Date(v)),
                            id: z.number()
                        })
                            .parse(JSON.parse(message));
                        const validated = returnType.safeParse(parsed.data);
                        if (!validated.success) {
                            return reject(new Error(`Invalid response data: ${JSON.stringify(validated.error.errors)}`));
                        }
                        clearTimeout(timeout);
                        resolve(validated.data);
                    }
                    catch (err) {
                        clearTimeout(timeout);
                        reject(err);
                    }
                    Redis._sub?.unsubscribe(responseChannel);
                };
                Redis._sub?.subscribe(responseChannel, ondata);
            });
            await Redis._pub?.publish(queryChannel, JSON.stringify({
                data,
                requestId,
                responseChannel,
                date: new Date().toISOString(),
                id: messageId++
            }));
            return responsePromise;
        });
    };
    Redis.queryListen = (service, event, reqSchema, handler) => {
        const channel = `query:${service}:${event}`;
        Redis._sub?.subscribe(channel, async (message) => {
            try {
                const parsed = z
                    .object({
                    data: z.unknown(),
                    requestId: z.string(),
                    responseChannel: z.string(),
                    date: z.string().transform((v) => new Date(v)),
                    id: z.number()
                })
                    .parse(JSON.parse(message));
                const validatedReq = reqSchema.safeParse(parsed.data);
                if (!validatedReq.success) {
                    error(`[queryListen:${channel}] Invalid request:`, validatedReq.error);
                    return;
                }
                const responseData = await handler({
                    data: validatedReq.data,
                    id: parsed.id,
                    date: parsed.date,
                    requestId: parsed.requestId,
                    responseChannel: parsed.responseChannel
                });
                await Redis._pub?.publish(parsed.responseChannel, JSON.stringify({
                    data: responseData,
                    date: new Date().toISOString(),
                    id: messageId++
                }));
            }
            catch (err) {
                error(`[queryListen:${channel}] Error:`, err);
            }
        });
    };
    const enqueue = (queueName, task, notify = false) => {
        return attemptAsync(async () => {
            const serialized = JSON.stringify(task);
            await Redis._queue?.rPush(`queue:${queueName}`, serialized);
            if (notify)
                await Redis._pub?.publish(`queue:${queueName}`, serialized); // Optional: publish to notify subscribers
        });
    };
    const dequeue = (queueName, schema, timeout = 0) => {
        return attemptAsync(async () => {
            const key = `queue:${queueName}`;
            const result = await Redis._queue?.blPop(key, timeout);
            if (!result || !result.element)
                return null;
            try {
                const parsed = JSON.parse(result.element);
                return schema.parse(parsed);
            }
            catch (err) {
                error(`[dequeue:${key}] Failed to parse or validate task`, err);
                throw err;
            }
        });
    };
    const clearQueue = (queueName) => {
        return attemptAsync(async () => {
            const key = `queue:${queueName}`;
            await Redis._queue?.del(key);
        });
    };
    const getQueueLength = (queueName) => {
        return attemptAsync(async () => {
            const key = `queue:${queueName}`;
            const length = await Redis._queue?.lLen(key);
            return length ?? 0;
        });
    };
    class QueueService {
        name;
        schema;
        _running = false;
        em = new EventEmitter();
        on = this.em.on.bind(this.em);
        once = this.em.once.bind(this.em);
        off = this.em.off.bind(this.em);
        constructor(name, schema) {
            this.name = name;
            this.schema = schema;
        }
        put(data, notify = false) {
            return enqueue(this.name, data, notify);
        }
        length() {
            return getQueueLength(this.name);
        }
        clear() {
            return clearQueue(this.name);
        }
        start() {
            if (this._running) {
                warn(`QueueService "${this.name}" is already running.`);
                return this.stop.bind(this);
            }
            this._running = true;
            const run = async () => {
                while (this._running) {
                    try {
                        const task = await dequeue(this.name, this.schema, 1000).unwrap();
                        if (task) {
                            this.em.emit('data', task);
                        }
                        else {
                            // No task available, wait a bit before checking again
                            await new Promise((resolve) => setTimeout(resolve, 100));
                        }
                    }
                    catch (err) {
                        error(`[QueueService:${this.name}] Error processing task:`, err);
                        this.em.emit('error', err);
                    }
                    await sleep(100); // Prevent tight loop
                }
            };
            run().catch((err) => {
                error(`[QueueService:${this.name}] Error in run loop:`, err);
                this.em.emit('error', err);
            });
            return this.stop.bind(this);
        }
        stop() {
            this._running = false;
        }
        get running() {
            return this._running;
        }
    }
    Redis.QueueService = QueueService;
    Redis.createQueueService = (queueName, schema) => {
        return new QueueService(queueName, schema);
    };
    Redis.emitStream = (streamName, stream) => {
        return attemptAsync(async () => {
            const id = messageId++;
            let packet = 0;
            stream.on('data', async (data) => {
                const payload = {
                    data,
                    date: new Date(),
                    packet: packet++,
                    id
                };
                const serialized = JSON.stringify(payload);
                await Redis._pub?.publish(`stream:${streamName}`, serialized);
            });
            stream.once('end', async () => {
                const endPayload = {
                    id,
                    date: new Date()
                };
                const serializedEnd = JSON.stringify(endPayload);
                await Redis._pub?.publish(`stream:${streamName}`, serializedEnd);
            });
            return new Promise((res) => {
                stream.on('end', res);
            });
        });
    };
    Redis.listenStream = (streamName, schema, handler, onEnd) => {
        return attemptAsync(async () => {
            const streamDataSchema = z.object({
                data: z.unknown(),
                date: z.string().transform((v) => new Date(v)),
                packet: z.number(),
                id: z.number()
            });
            const streamEndSchema = z.object({
                id: z.number(),
                date: z.string().transform((v) => new Date(v))
            });
            await Redis._sub?.subscribe(`stream:${streamName}`, (message) => {
                try {
                    const raw = JSON.parse(message);
                    // Try parsing as StreamData
                    if ('data' in raw && 'packet' in raw) {
                        const parsed = streamDataSchema.parse(raw);
                        const validated = schema.parse(parsed.data);
                        handler(validated, parsed.date, parsed.packet, parsed.id);
                    }
                    else {
                        // Fallback to StreamEnd
                        const parsed = streamEndSchema.parse(raw);
                        onEnd?.(parsed.id, parsed.date);
                    }
                }
                catch (err) {
                    error(`[listenStream:${streamName}] Invalid stream message:`, err);
                }
            });
        });
    };
})(Redis || (Redis = {}));
