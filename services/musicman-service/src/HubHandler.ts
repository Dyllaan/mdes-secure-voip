import { config } from './config';
import { createLogger, describeSecret, truncateForLog } from './logging';

const hubLog = createLogger('hubHandler');

/**
 * Handles the bot joining a hub by restfully calling the hub service's join endpoint. This is separate from the BotInstance class since joining a hub is a distinct step that happens before the bot starts its media playback responsibilities. The HubHandler can be extended in the future to include additional hub-related functionalities if needed.
 * Uses the bot secret to verify its a bot and allow its join without an invite code
 */
export class HubHandler {

    static async joinHub(hubId: string, token: string): Promise<void> {
        const joinLog = hubLog.child('joinHub', {
            hubId,
            url: `${config.HUB_SERVICE_URL}/hubs/${hubId}/bot-join`,
            tokenLength: token.length,
            botSecret: describeSecret(config.BOT_SECRET),
        });
        joinLog.info('hub.join.start');
        const res = await fetch(`${config.HUB_SERVICE_URL}/hubs/${hubId}/bot-join`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Bot-Secret':  config.BOT_SECRET,
                'Content-Type':  'application/json',
            },
        });

        if (res.ok) {
            joinLog.info('hub.join.success', { status: res.status });
            return;
        }

        const body = await res.json().catch(() => ({})) as { error?: string };
        joinLog.warn('hub.join.failed', {
            status: res.status,
            errorMessage: truncateForLog(body.error),
        });
        throw new Error(`Musicman failed to join hub: ${body.error ?? 'unknown error'}`);
    }
}
