import { createClient } from 'redis';
import { type ResultPromise } from 'ts-utils/check';
import { z } from 'zod';
import type { Stream } from 'ts-utils/stream';
export declare namespace Redis {
    export let REDIS_NAME: string;
    export const clientId: string;
    export let _sub: ReturnType<typeof createClient> | undefined;
    export let _pub: ReturnType<typeof createClient> | undefined;
    export let _queue: ReturnType<typeof createClient> | undefined;
    export const connect: (name: string) => ResultPromise<void>;
    export const disconnect: () => ResultPromise<void, Error>;
    export class ListeningService<Events extends Record<string, z.ZodType>, Name extends string> {
        readonly name: Name;
        readonly events: Events;
        static services: Map<string, ListeningService<any, any>>;
        private readonly em;
        on: <K extends keyof Events>(event: K, listener: (payload: {
            date: Date;
            id: number;
            data: z.infer<Events[K]>;
        }) => void) => () => boolean | undefined;
        once: <K extends keyof Events>(event: K, listener: (payload: {
            date: Date;
            id: number;
            data: z.infer<Events[K]>;
        }) => void) => () => boolean | undefined;
        off: <K extends keyof Events>(event: K, listener: (payload: {
            date: Date;
            id: number;
            data: z.infer<Events[K]>;
        }) => void) => boolean | undefined;
        emit: <K extends keyof Events>(event: K, payload: {
            date: Date;
            id: number;
            data: z.infer<Events[K]>;
        }) => void;
        constructor(name: Name, events: Events);
    }
    export const createListeningService: <E extends {
        [key: string]: z.ZodType;
    }, Name extends string>(name: Name, events: E) => ListeningService<E, Name>;
    export const emit: (event: string, data: unknown) => ResultPromise<void, Error>;
    type GlobalEvents = {
        'pub-error': Error;
        'pub-connect': void;
        'pub-disconnect': void;
        'pub-reconnect': void;
        'sub-error': Error;
        'sub-connect': void;
        'sub-disconnect': void;
        'sub-reconnect': void;
    };
    export const on: <K extends keyof GlobalEvents>(event: K, listener: (data: GlobalEvents[K]) => void) => () => boolean | undefined;
    export const once: <K extends keyof GlobalEvents>(event: K, listener: (data: GlobalEvents[K]) => void) => () => boolean | undefined;
    export const off: <K extends keyof GlobalEvents>(event: K, listener?: ((data: GlobalEvents[K]) => void) | undefined) => boolean | undefined;
    export const query: <Req, Res>(service: string, event: string, data: Req, returnType: z.ZodType<Res>, timeoutMs?: number) => ResultPromise<Res, Error>;
    type QueryHandler<Req> = (args: {
        data: Req;
        id: number;
        date: Date;
        requestId: string;
        responseChannel: string;
    }) => Promise<unknown> | unknown;
    export const queryListen: <Req>(service: string, event: string, reqSchema: z.ZodType<Req>, handler: QueryHandler<Req>) => void;
    export class QueueService<T> {
        readonly name: string;
        readonly schema: z.ZodType<T>;
        private _running;
        private em;
        on: <K extends "data" | "stop" | "error" | "start">(event: K, listener: (data: {
            data: T;
            stop: void;
            error: Error;
            start: void;
        }[K]) => void) => () => boolean | undefined;
        once: <K extends "data" | "stop" | "error" | "start">(event: K, listener: (data: {
            data: T;
            stop: void;
            error: Error;
            start: void;
        }[K]) => void) => () => boolean | undefined;
        off: <K extends "data" | "stop" | "error" | "start">(event: K, listener?: ((data: {
            data: T;
            stop: void;
            error: Error;
            start: void;
        }[K]) => void) | undefined) => boolean | undefined;
        constructor(name: string, schema: z.ZodType<T>);
        put(data: T, notify?: boolean): ResultPromise<void, Error>;
        length(): ResultPromise<number, Error>;
        clear(): ResultPromise<void, Error>;
        start(): () => void;
        stop(): void;
        get running(): boolean;
    }
    export const createQueueService: <T>(queueName: string, schema: z.ZodType<T>) => QueueService<T>;
    export const emitStream: <T>(streamName: string, stream: Stream<T>) => ResultPromise<void, Error>;
    export const listenStream: <T>(streamName: string, schema: z.ZodType<T>, handler: (data: T, date: Date, packet: number, id: number) => void, onEnd?: (id: number, date: Date) => void) => ResultPromise<void, Error>;
    export {};
}
