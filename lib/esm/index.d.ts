import '@total-typescript/ts-reset';
export declare const generateWebhookHmac: (payload: string, secret: string) => string;
export declare const main: (PORT?: number, secret?: string, redisName?: string) => Promise<void>;
