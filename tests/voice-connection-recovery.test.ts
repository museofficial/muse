import {
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  type VoiceConnection,
} from '@discordjs/voice';
import {describe, expect, it, vi} from 'vitest';
import {
  destroyVoiceConnection,
  recoverVoiceConnection,
  type VoiceConnectionRecoveryRuntime,
} from '../src/services/voice-connection-recovery.js';

const makeConnection = (overrides: Record<string, unknown> = {}) => ({
  destroy: vi.fn(),
  rejoin: vi.fn(() => true),
  rejoinAttempts: 0,
  state: {status: VoiceConnectionStatus.Disconnected},
  ...overrides,
}) as unknown as VoiceConnection;

const makeHarness = (connection: VoiceConnection) => {
  let current: VoiceConnection | null = connection;
  const dispose = vi.fn((candidate: VoiceConnection) => {
    destroyVoiceConnection(candidate);
    if (current === candidate) {
      current = null;
    }
  });
  const runtime: VoiceConnectionRecoveryRuntime = {
    waitForState: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
  };

  return {
    dispose,
    getCurrent: () => current,
    options: {
      dispose,
      isCurrent: (candidate: VoiceConnection) => current === candidate,
      runtime,
    },
    replace: (replacement: VoiceConnection) => {
      current = replacement;
    },
    runtime,
  };
};

describe('recoverVoiceConnection', () => {
  it.each([
    VoiceConnectionStatus.Connecting,
    VoiceConnectionStatus.Signalling,
  ])('keeps a current 4014 connection recovered through %s', async recoveredStatus => {
    const connection = makeConnection({
      state: {
        status: VoiceConnectionStatus.Disconnected,
        reason: VoiceConnectionDisconnectReason.WebSocketClose,
        closeCode: 4014,
      },
    });
    const harness = makeHarness(connection);
    harness.runtime.waitForState = vi.fn(async (_candidate, status) => {
      if (status === recoveredStatus) {
        connection.state = {status: recoveredStatus};
        return;
      }

      return new Promise<never>(() => undefined);
    });

    await recoverVoiceConnection(connection, harness.options);

    expect(harness.runtime.waitForState).toHaveBeenCalledWith(
      connection,
      VoiceConnectionStatus.Connecting,
      5_000,
    );
    expect(harness.runtime.waitForState).toHaveBeenCalledWith(
      connection,
      VoiceConnectionStatus.Signalling,
      5_000,
    );
    expect(harness.dispose).not.toHaveBeenCalled();
    expect(harness.getCurrent()).toBe(connection);
  });

  it('disposes a 4014 timeout and never destroys an already Destroyed connection twice', async () => {
    const connection = makeConnection({
      state: {
        status: VoiceConnectionStatus.Disconnected,
        reason: VoiceConnectionDisconnectReason.WebSocketClose,
        closeCode: 4014,
      },
    });
    const harness = makeHarness(connection);
    harness.runtime.waitForState = vi.fn().mockImplementation(async () => {
      connection.state = {status: VoiceConnectionStatus.Destroyed};
      throw new Error('timeout');
    });

    await recoverVoiceConnection(connection, harness.options);

    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(harness.getCurrent()).toBeNull();
  });

  it('backs off in five-second increments and accepts a successful rejoin below five attempts', async () => {
    const connection = makeConnection({rejoinAttempts: 2});
    const harness = makeHarness(connection);

    await recoverVoiceConnection(connection, harness.options);

    expect(harness.runtime.sleep).toHaveBeenCalledWith(15_000);
    expect(connection.rejoin).toHaveBeenCalledOnce();
    expect(harness.dispose).not.toHaveBeenCalled();
  });

  it('preserves a connection that becomes Ready during transient backoff', async () => {
    const connection = makeConnection({rejoinAttempts: 1});
    const harness = makeHarness(connection);
    harness.runtime.sleep = vi.fn(async () => {
      connection.state = {status: VoiceConnectionStatus.Ready};
    });

    await recoverVoiceConnection(connection, harness.options);

    expect(connection.rejoin).not.toHaveBeenCalled();
    expect(harness.dispose).not.toHaveBeenCalled();
    expect(harness.getCurrent()).toBe(connection);
  });

  it('disposes a stale owner after backoff without touching its replacement', async () => {
    const connection = makeConnection({rejoinAttempts: 1});
    const replacement = makeConnection();
    const harness = makeHarness(connection);
    harness.runtime.sleep = vi.fn(async () => {
      harness.replace(replacement);
    });

    await recoverVoiceConnection(connection, harness.options);

    expect(connection.rejoin).not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(replacement.destroy).not.toHaveBeenCalled();
    expect(harness.getCurrent()).toBe(replacement);
  });

  it.each([
    {name: 'failed rejoin', attempts: 0, rejoin: false, sleeps: true},
    {name: 'exhausted retries', attempts: 5, rejoin: true, sleeps: false},
  ])('disposes a disconnected connection after $name', async ({attempts, rejoin, sleeps}) => {
    const connection = makeConnection({
      rejoin: vi.fn(() => rejoin),
      rejoinAttempts: attempts,
    });
    const harness = makeHarness(connection);

    await recoverVoiceConnection(connection, harness.options);

    expect(harness.runtime.sleep).toHaveBeenCalledTimes(sleeps ? 1 : 0);
    expect(connection.rejoin).toHaveBeenCalledTimes(attempts < 5 ? 1 : 0);
    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(connection.destroy).toHaveBeenCalledOnce();
  });
});

describe('destroyVoiceConnection', () => {
  it('is idempotent for a connection whose destroy transitions its state', () => {
    const connection = makeConnection();
    vi.mocked(connection.destroy).mockImplementation(() => {
      connection.state = {status: VoiceConnectionStatus.Destroyed};
    });

    destroyVoiceConnection(connection);
    destroyVoiceConnection(connection);

    expect(connection.destroy).toHaveBeenCalledOnce();
  });
});
