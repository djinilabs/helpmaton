/**
 * Subscription Email Notifications
 * Sends emails for payment issues and subscription changes
 */

import { sendEmail } from "../send-email";
import type { SubscriptionRecord } from "../tables/schema";

import { getPlanLimits } from "./subscriptionPlans";

const BASE_URL = process.env.BASE_URL || "https://app.helpmaton.com";

/**
 * Send payment failed email when subscription goes past due
 */
export async function sendPaymentFailedEmail(
  subscription: SubscriptionRecord,
  userEmail: string
): Promise<void> {
  const portalUrl = subscription.lemonSqueezyCustomerId
    ? `https://app.lemonsqueezy.com/my-account/customer/${subscription.lemonSqueezyCustomerId}`
    : `${BASE_URL}/subscription`;

  const subject = "Payment Failed - Action Required";
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .content { padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Payment Failed - Action Required</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>We were unable to process the payment for your ${subscription.plan} subscription. Your subscription is now past due.</p>
          
          <div class="warning">
            <strong>Important:</strong> You have 7 days to update your payment method before your subscription is downgraded to the free plan.
          </div>
          
          <p>To continue enjoying your ${subscription.plan} plan benefits, please update your payment method:</p>
          
          <a href="${portalUrl}" class="button">Update Payment Method</a>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>
          
          <p>Best regards,<br>The Helpmaton Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Payment Failed - Action Required

Hello,

We were unable to process the payment for your ${subscription.plan} subscription. Your subscription is now past due.

Important: You have 7 days to update your payment method before your subscription is downgraded to the free plan.

To continue enjoying your ${subscription.plan} plan benefits, please update your payment method:
${portalUrl}

If you have any questions or need assistance, please don't hesitate to contact us.

Best regards,
The Helpmaton Team
  `;

  await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });
}

/**
 * Send grace period expiring warning email
 */
export async function sendGracePeriodExpiringEmail(
  subscription: SubscriptionRecord,
  userEmail: string,
  daysRemaining: number
): Promise<void> {
  const portalUrl = subscription.lemonSqueezyCustomerId
    ? `https://app.lemonsqueezy.com/my-account/customer/${subscription.lemonSqueezyCustomerId}`
    : `${BASE_URL}/subscription`;

  const subject = "Your Subscription Will Expire Soon";
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .content { padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background: #ffc107; color: #000; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; }
        .urgent { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⚠️ Your Subscription Will Expire Soon</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>Your ${
            subscription.plan
          } subscription will be downgraded to the free plan in ${daysRemaining} day${
    daysRemaining !== 1 ? "s" : ""
  } if payment is not updated.</p>
          
          <div class="urgent">
            <strong>Urgent Action Required:</strong> Please update your payment method now to avoid losing access to your ${
              subscription.plan
            } plan features.
          </div>
          
          <a href="${portalUrl}" class="button">Update Payment Method Now</a>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>
          
          <p>Best regards,<br>The Helpmaton Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Your Subscription Will Expire Soon

Hello,

Your ${
    subscription.plan
  } subscription will be downgraded to the free plan in ${daysRemaining} day${
    daysRemaining !== 1 ? "s" : ""
  } if payment is not updated.

Urgent Action Required: Please update your payment method now to avoid losing access to your ${
    subscription.plan
  } plan features.

Update your payment method: ${portalUrl}

If you have any questions or need assistance, please don't hesitate to contact us.

Best regards,
The Helpmaton Team
  `;

  await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });
}

/**
 * Send subscription downgraded email
 */
export async function sendSubscriptionDowngradedEmail(
  subscription: SubscriptionRecord,
  userEmail: string
): Promise<void> {
  const freeLimits = getPlanLimits("free");

  const subject = "Your Subscription Has Been Downgraded";
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f8d7da; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .content { padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .info { background: #d1ecf1; border-left: 4px solid #0c5460; padding: 15px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Subscription Downgraded</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>Your ${
            subscription.plan
          } subscription has been downgraded to the free plan due to payment failure.</p>
          
          <div class="info">
            <strong>What this means:</strong>
            <ul>
              <li>Your subscription is now on the free plan</li>
              <li>You have access to ${
                freeLimits?.maxWorkspaces || 1
              } workspace${freeLimits?.maxWorkspaces !== 1 ? "s" : ""}</li>
              <li>You have access to ${
                freeLimits?.maxDocuments || 10
              } document${freeLimits?.maxDocuments !== 1 ? "s" : ""}</li>
              <li>You have access to ${freeLimits?.maxAgents || 1} agent${
    freeLimits?.maxAgents !== 1 ? "s" : ""
  }</li>
            </ul>
          </div>
          
          <p>To restore your ${
            subscription.plan
          } plan benefits, you can upgrade again:</p>
          
          <a href="${BASE_URL}/subscription" class="button">Upgrade Subscription</a>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>
          
          <p>Best regards,<br>The Helpmaton Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Subscription Downgraded

Hello,

Your ${
    subscription.plan
  } subscription has been downgraded to the free plan due to payment failure.

What this means:
- Your subscription is now on the free plan
- You have access to ${freeLimits?.maxWorkspaces || 1} workspace${
    freeLimits?.maxWorkspaces !== 1 ? "s" : ""
  }
- You have access to ${freeLimits?.maxDocuments || 10} document${
    freeLimits?.maxDocuments !== 1 ? "s" : ""
  }
- You have access to ${freeLimits?.maxAgents || 1} agent${
    freeLimits?.maxAgents !== 1 ? "s" : ""
  }

To restore your ${subscription.plan} plan benefits, you can upgrade again:
${BASE_URL}/subscription

If you have any questions or need assistance, please don't hesitate to contact us.

Best regards,
The Helpmaton Team
  `;

  await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });
}

/**
 * Send subscription cancelled email
 */
export async function sendSubscriptionCancelledEmail(
  subscription: SubscriptionRecord,
  userEmail: string
): Promise<void> {
  const subject = "Your Subscription Has Been Cancelled";
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .content { padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Subscription Cancelled</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>Your ${
            subscription.plan
          } subscription has been cancelled as requested.</p>
          
          ${
            subscription.endsAt
              ? `<p>Your subscription will remain active until ${new Date(
                  subscription.endsAt
                ).toLocaleDateString()}.</p>`
              : ""
          }
          
          <p>After that date, your subscription will be downgraded to the free plan.</p>
          
          <p>If you change your mind, you can reactivate your subscription:</p>
          
          <a href="${BASE_URL}/subscription" class="button">Manage Subscription</a>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>
          
          <p>Best regards,<br>The Helpmaton Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Subscription Cancelled

Hello,

Your ${subscription.plan} subscription has been cancelled as requested.

${
  subscription.endsAt
    ? `Your subscription will remain active until ${new Date(
        subscription.endsAt
      ).toLocaleDateString()}.\n\n`
    : ""
}After that date, your subscription will be downgraded to the free plan.

If you change your mind, you can reactivate your subscription:
${BASE_URL}/subscription

If you have any questions or need assistance, please don't hesitate to contact us.

Best regards,
The Helpmaton Team
  `;

  await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });
}
