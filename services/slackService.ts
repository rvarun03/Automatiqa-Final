import { decryptToken } from './encryptionService';

export interface SlackConfig {
  workspaceName?: string;
  channelName?: string;
  webhookUrl?: string;
  botToken?: string;
  enabled?: boolean;
}

export interface SlackNotificationDetails {
  issueKey: string;
  summary: string;
  projectName: string;
  priority: string;
  severity: string;
  reporter: string;
  jiraUrl: string;
  issueType?: string;
}

/**
 * Sends a Slack notification using either an Incoming Webhook or Bot Token.
 */
export async function sendSlackNotification(
  config: SlackConfig,
  details: SlackNotificationDetails
): Promise<{ success: boolean; error?: string }> {
  if (!config.enabled) {
    return { success: false, error: 'Slack notification is disabled' };
  }

  const webhookUrl = config.webhookUrl ? decryptToken(config.webhookUrl) : '';
  const botToken = config.botToken ? decryptToken(config.botToken) : '';
  const channel = config.channelName || '';

  if (!webhookUrl && !botToken) {
    return { success: false, error: 'Neither Webhook URL nor Bot Token is configured' };
  }

  const isStory = details.issueType?.toLowerCase().includes('story') || false;
  const headerIcon = isStory ? '📝' : '🚨';
  const issueTypeName = isStory ? 'User Story' : 'Bug';

  // Format Slack message blocks for beautiful display
  const messagePayload = {
    text: `${headerIcon} Jira ${issueTypeName} Created: ${details.issueKey} - ${details.summary}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${headerIcon} New Jira ${issueTypeName} Created`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Project Name:*\n${details.projectName}`
          },
          {
            type: 'mrkdwn',
            text: `*Jira Issue:*\n<${details.jiraUrl}|${details.issueKey}>`
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Priority:*\n${details.priority}`
          },
          {
            type: 'mrkdwn',
            text: `*Severity:*\n${details.severity}`
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Reporter:*\n${details.reporter}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${issueTypeName} Summary:*\n${details.summary}`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Jira Issue',
              emoji: true
            },
            url: details.jiraUrl,
            style: 'primary'
          }
        ]
      }
    ]
  };

  try {
    if (webhookUrl) {
      // Send via Incoming Webhook
      console.log('Dispatching Slack notification via Webhook...');
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Slack Webhook returned status ${response.status}: ${errorText}`);
      }

      return { success: true };
    } else if (botToken) {
      // Send via Slack Bot Token using chat.postMessage
      console.log('Dispatching Slack notification via Bot User Token...');
      if (!channel) {
        throw new Error('Channel name is required when using Slack Bot User Token');
      }

      const botPayload = {
        channel: channel.startsWith('#') ? channel : `#${channel}`,
        ...messagePayload
      };

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${botToken}`
        },
        body: JSON.stringify(botPayload)
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Slack API returned status ${response.status}`);
      }

      return { success: true };
    }

    return { success: false, error: 'No valid delivery mechanism found' };
  } catch (error: any) {
    console.error('Slack Notification dispatch failed:', error);
    return { success: false, error: error.message || 'Error communicating with Slack API' };
  }
}

/**
 * Sends custom payload or test playback report to Slack
 */
export async function sendSlackCustomMessage(
  config: SlackConfig,
  payload: {
    channel?: string;
    text: string;
    attachments?: any[];
    blocks?: any[];
  }
): Promise<{ success: boolean; error?: string }> {
  if (!config.enabled) {
    return { success: false, error: 'Slack notification is disabled' };
  }

  const webhookUrl = config.webhookUrl ? decryptToken(config.webhookUrl) : '';
  const botToken = config.botToken ? decryptToken(config.botToken) : '';
  const channel = payload.channel || config.channelName || '#qa-automation';

  if (!webhookUrl && !botToken) {
    return { success: false, error: 'Neither Webhook URL nor Bot Token is configured' };
  }

  const messagePayload: any = {
    text: payload.text
  };
  if (payload.blocks) messagePayload.blocks = payload.blocks;
  if (payload.attachments) messagePayload.attachments = payload.attachments;

  try {
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messagePayload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Slack Webhook error ${response.status}: ${errorText}`);
      }
      return { success: true };
    } else if (botToken) {
      const botPayload = {
        channel: channel.startsWith('#') ? channel : `#${channel}`,
        ...messagePayload
      };
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${botToken}`
        },
        body: JSON.stringify(botPayload)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Slack API returned status ${response.status}`);
      }
      return { success: true };
    }
    return { success: false, error: 'No delivery channel configured' };
  } catch (error: any) {
    console.error('Slack Custom Message failed:', error);
    return { success: false, error: error.message || 'Error communicating with Slack API' };
  }
}

