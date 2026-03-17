import { config } from './config';

export class HubHandler {

    static async joinHub(hubId: string, token: string): Promise<void> {
        const res = await fetch(`${config.HUB_SERVICE_URL}/hubs/${hubId}/bot-join`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Bot-Secret':  config.BOT_SECRET,
                'Content-Type':  'application/json',
            },
        });

        if (res.ok) {
            console.log('[Hub] Bot joined hub');
            return;
        }

        const body = await res.json() as { error?: string };
        throw new Error(`Failed to join hub: ${body.error ?? 'unknown error'}`);
    }
}