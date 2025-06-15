import express from 'express';
import { createServer } from 'http';
import { Redis } from './redis';
import { config } from 'dotenv';
import { z } from 'zod';
config();

const app = express();
const server = createServer(app);
const PORT = Number(process.env.PORT) || 3000;
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
app.post('/', 
express.json(),
(req, res) => {
    try {
        // serverChannel.send('ping', 'pong');
        const body = req.body;
        console.log('Received request:', body);
        console.log('Headers:', req.headers);

        res.status(200).json({
            message: 'Request received successfully',
            data: body,
            headers: req.headers
        })
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).send('Internal Server Error');
    }
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});