import express from 'express';
import { createServer } from 'http';
import { Redis } from './redis';
import { config } from 'dotenv';
import { z } from 'zod';
import fs from 'fs/promises';
import '@total-typescript/ts-reset';
import { message_schemas } from './schemas';
import crypto from 'crypto';
import bodyParser from 'body-parser';

const generateWebhookHmac = (payload: string) => {
  return crypto
    .createHmac('sha256', String(process.env.TBA_SECRET))
    .update(payload, 'utf8')
    .digest('hex');
}

config();

const app = express();
const server = createServer(app);
const PORT = Number(process.env.PORT) || 3000;

console.log(process.env.TBA_SECRET)


Redis.connect().then(res => {
    if (res.isOk()) {
        console.log('Redis connected successfully');
    } else {
        console.error('Failed to connect to Redis:', res.error);
    }
});

const serverChannel = Redis.createChannel('server', {
    ping: z.string(),
}, {
    ping: z.string(),
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
    const schema = message_schemas[message_type];
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
(req, res) => {
    try {
        if (req.headers['x-tba-hmac'] !== generateWebhookHmac(req.body)) {
            console.error('Invalid TBA secret');
            res.status(403).send('Forbidden: Invalid TBA secret');
            return;
        }

        const tbaEvent = parseTBAEvent(JSON.parse(req.body));
        if (!tbaEvent) {
            res.status(200).send('Thank you for feeding us! Nom nom nom');
            return;
        }

        res.status(200).send('Thank you for feeding us! Nom nom nom');
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(200).send('Internal Server Error, please try again later');
    }
});

app.get('/', (req, res) => {
    res.status(200).send('Hello TBA! You guys are awesome!');
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});