import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import Config from '../services/config.js';
// @ts-expect-error  no typing available for sync-fetch
import fetch from 'sync-fetch';

interface OAuth2Request {
  grant_type: string;
  scope: string;
  permissions: string;
  client_id: string;
  client_secret: string;
}
@injectable()
export default class {
  private readonly config: Config;

  constructor(@inject(TYPES.Config) config: Config) {
    this.config = config;
  }

  getBearerToken(): string {
    const data: OAuth2Request = {
      grant_type: 'client_credentials',
      scope: 'bot applications.commands applications.commands.update applications.commands.permissions.update',
      permissions: '36700288',
      client_id: this.config.DISCORD_CLIENT_ID,
      client_secret: this.config.DISCORD_CLIENT_SECRET,
    };
    const formBody = Object.keys(data).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key as keyof OAuth2Request])).join('&');

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-assignment
    const response = fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      body: formBody,
      headers,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (!response.ok) {
      throw new Error('Bearer token couldn\'t be retrieved. Please make sure to set correct DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return
    return response.json().access_token;
  }
}
