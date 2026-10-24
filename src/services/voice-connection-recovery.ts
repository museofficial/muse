import {setTimeout as sleep} from 'timers/promises';
import {
  entersState,
  VoiceConnection,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
} from '@discordjs/voice';

export interface VoiceConnectionRecoveryRuntime {
  waitForState(
    connection: VoiceConnection,
    status: VoiceConnectionStatus,
    timeout: number,
  ): Promise<unknown>;
  sleep(delay: number): Promise<unknown>;
}

export interface VoiceConnectionRecoveryOptions {
  runtime?: VoiceConnectionRecoveryRuntime;
  isCurrent(connection: VoiceConnection): boolean;
  dispose(connection: VoiceConnection): void;
}

const defaultRuntime: VoiceConnectionRecoveryRuntime = {
  waitForState: async (connection, status, timeout) => {
    await entersState(connection, status, timeout);
  },
  sleep,
};

const getVoiceConnectionStatus = (connection: VoiceConnection): VoiceConnectionStatus => (
  connection.state.status
);

export function destroyVoiceConnection(connection: VoiceConnection): void {
  if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
    connection.destroy();
  }
}

export async function recoverVoiceConnection(
  connection: VoiceConnection,
  {isCurrent, dispose, runtime = defaultRuntime}: VoiceConnectionRecoveryOptions,
): Promise<void> {
  if (!isCurrent(connection)) {
    dispose(connection);
    return;
  }

  if (connection.state.status !== VoiceConnectionStatus.Disconnected) {
    if (connection.state.status === VoiceConnectionStatus.Destroyed) {
      dispose(connection);
    }

    return;
  }

  const disconnectedState = connection.state;
  if (disconnectedState.reason === VoiceConnectionDisconnectReason.WebSocketClose
    && disconnectedState.closeCode === 4014) {
    try {
      await Promise.race([
        runtime.waitForState(connection, VoiceConnectionStatus.Connecting, 5_000),
        runtime.waitForState(connection, VoiceConnectionStatus.Signalling, 5_000),
      ]);
      if (!isCurrent(connection) || getVoiceConnectionStatus(connection) === VoiceConnectionStatus.Destroyed) {
        dispose(connection);
      }

      return;
    } catch {
      dispose(connection);
      return;
    }
  }

  if (connection.rejoinAttempts < 5) {
    await runtime.sleep((connection.rejoinAttempts + 1) * 5_000);

    if (!isCurrent(connection)) {
      dispose(connection);
      return;
    }

    const connectionStatus = getVoiceConnectionStatus(connection);
    if (connectionStatus !== VoiceConnectionStatus.Disconnected) {
      if (connectionStatus === VoiceConnectionStatus.Destroyed) {
        dispose(connection);
      }

      return;
    }

    if (connection.rejoin()) {
      return;
    }
  }

  dispose(connection);
}
