export type AlertChannel = 'telegram' | 'email';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertConfig {
  enabled: boolean;
  channels: {
    telegram?: {
      botToken: string;
      chatId: string;
    };
    email?: {
      to: string;
    };
  };
}

export interface Alert {
  severity: AlertSeverity;
  title: string;
  message: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}
