import express from 'express';
import { createServer } from 'http';
import { z } from 'zod';
import fs from 'fs/promises';
import '@total-typescript/ts-reset';
import { messageSchemas } from './schemas';
import crypto from 'crypto';
import bodyParser from 'body-parser';
import { config } from 'dotenv';
import { Redis } from 'redis-utils';

export const generateWebhookHmac = (payload: string, secret: string) => {
    return crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex');
}

export const main = async (
    PORT: number = 3000, 
    secret: string = String(process.env.TBA_SECRET),
    redisName: string = String(process.env.REDIS_NAME),
) => {
    const app = express();
    const server = createServer(app);

    // await Redis.connect(redisName).unwrap();

    const redis = new Redis({
        name: redisName,
        url: process.env.REDIS_URL,
    });

    const logEvent = async (event: string, data: unknown) => {
        if (!await fs.access('../logs').then(() => true).catch(() => false)) {
            console.log('Logs directory does not exist, creating it...');
            await fs.mkdir('../logs', { recursive: true });
            await fs.writeFile('../logs/events.log', '', 'utf8');
        }

        await fs.appendFile(
            '../logs/events.log',
            `${new Date().toISOString()} - ${event}: ${JSON.stringify(data)}\n`,
        );
    }

    const parseTBAEvent = (data: unknown) => {
        const parsed = z.object({
            message_data: z.unknown(),
            message_type: z.string(),
        }).safeParse(data);

        if (!parsed.success) {
            console.error('Failed to parse TBA event:', parsed.error);
            return null;
        }

        const { message_data, message_type } = parsed.data;
        if (message_type === 'awards_posted') {
            return null;
        }
        const schema = messageSchemas[message_type];
        if (!schema) {
            console.error(`No schema found for message type: ${message_type}`);
            return null;
        }

        const validation = schema.safeParse(message_data);
        if (!validation.success) {
            console.error(`Failed to validate message data for type ${message_type}:`, validation.error);
            return null;
        }

        logEvent(message_type, validation.data).catch(err => {
            console.error('Failed to log event:', err);
        });

        return {
            type: message_type,
            data: validation.data,
        };
    };

    app.post('/', 
        bodyParser.text({ type: 'application/json' }),
    async (req, res) => {
        try {
            if (req.headers['x-tba-hmac'] !== generateWebhookHmac(req.body, secret)) {
                console.error('Invalid TBA secret');
                res.status(403).send('Forbidden: Invalid TBA secret');
                return;
            }

            const tbaEvent = parseTBAEvent(JSON.parse(req.body));
            if (!tbaEvent) {
                console.error('Failed to parse TBA event');
                res.status(200).send('Thank you for feeding us! Nom nom nom');
                return;
            }

            await redis.emit(tbaEvent.type, tbaEvent.data).unwrap();

            res.status(200).send('Thank you for feeding us! Nom nom nom');
        } catch (error) {
            console.error('Error processing request:', error);
            res.status(200).send('Internal Server Error, please try again later');
        }
    });

    app.get('/', (req, res) => {
        res.status(200).send('Hello TBA! You guys are awesome!');
    });

    return new Promise<void>((res, rej) => {
        server.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
        server.on('error', (err) => {
            console.error('Server error:', err);
            rej(err);
        });
        server.on('close', () => {
            console.log('Server closed');
            res();
        });

        const onexit = () => {
            server.close(() => {
                console.log('Server closed');
                res();
            });
        }

        process.on('SIGINT', onexit);
        process.on('SIGTERM', onexit);
        process.on('exit', onexit);
        process.on('uncaughtException', (err) => {
            console.error('Uncaught exception:', err);
            server.close(() => {
                console.log('Server closed');
                rej(err);
            });
        });
        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled rejection at:', promise, 'reason:', reason);
            server.close(() => {
                console.log('Server closed');
                rej(reason);
            });
        });
    });
}



if (require.main === module) {
    config();
    main().catch(error => {
        console.error('Error starting server:', error);
        process.exit(1);
    });
}