import { OAuth2Client } from 'google-auth-library';

export interface InvocationVerifier {
  verify(authorizationHeader: string | undefined): Promise<void>;
}

export class InvocationAuthenticationError extends Error {
  constructor(cause?: unknown) {
    super('A valid Cloud Tasks OIDC token is required.', { cause });
    this.name = 'InvocationAuthenticationError';
  }
}

export class GoogleOidcInvocationVerifier implements InvocationVerifier {
  private readonly client = new OAuth2Client();

  constructor(
    private readonly audience: string,
    private readonly allowedServiceAccountEmail: string,
  ) {}

  async verify(authorizationHeader: string | undefined): Promise<void> {
    const token = authorizationHeader?.startsWith('Bearer ')
      ? authorizationHeader.slice('Bearer '.length).trim()
      : '';
    if (token.length === 0) {
      throw new InvocationAuthenticationError();
    }

    try {
      const ticket = await this.client.verifyIdToken({ idToken: token, audience: this.audience });
      const payload = ticket.getPayload();
      if (payload?.email !== this.allowedServiceAccountEmail || payload.email_verified !== true) {
        throw new InvocationAuthenticationError();
      }
    } catch (error) {
      if (error instanceof InvocationAuthenticationError) throw error;
      throw new InvocationAuthenticationError(error);
    }
  }
}
