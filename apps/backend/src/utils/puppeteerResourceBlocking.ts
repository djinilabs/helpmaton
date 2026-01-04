// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-core is installed in container image
import type { Page } from "puppeteer-core";

/**
 * Type definition for Puppeteer HTTPRequest
 * This matches the interface used by puppeteer-core
 */
interface HTTPRequest {
  resourceType(): string;
  url(): string;
  abort(): void;
  continue(): void;
}

// Known tracker domains to block
export const TRACKER_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.net",
  "facebook.com",
  "doubleclick.net",
  "adservice.google",
  "googlesyndication.com",
  "amazon-adsystem.com",
  "ads-twitter.com",
  "analytics.twitter.com",
  "scorecardresearch.com",
  "quantserve.com",
  "outbrain.com",
  "taboola.com",
  "bing.com",
  "bingads.microsoft.com",
  "ads.yahoo.com",
  "advertising.com",
  "adnxs.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "criteo.com",
  "media.net",
  "adsrvr.org",
  "adtechus.com",
  "adform.net",
  "adroll.com",
  "moatads.com",
  "chartbeat.com",
  "parsely.com",
  "newrelic.com",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "hotjar.com",
  "fullstory.com",
  "mouseflow.com",
  "crazyegg.com",
  "optimizely.com",
  "vwo.com",
  "abtasty.com",
  "convert.com",
  "unbounce.com",
  "intercom.io",
  "zendesk.com",
  "drift.com",
  "olark.com",
  "livechatinc.com",
  "uservoice.com",
  "helpscout.com",
  "freshdesk.com",
  "zoho.com",
  "salesforce.com",
  "marketo.com",
  "hubspot.com",
  "pardot.com",
  "eloqua.com",
  "act-on.com",
  "constantcontact.com",
  "mailchimp.com",
  "sendgrid.com",
  "mandrill.com",
  "postmarkapp.com",
  "sparkpost.com",
  "mailgun.com",
  "sendinblue.com",
  "getresponse.com",
  "aweber.com",
  "icontact.com",
  "verticalresponse.com",
  "benchmarkemail.com",
  "campaignmonitor.com",
  "drip.com",
  "klaviyo.com",
  "omnisend.com",
  "autopilot.com",
  "customer.io",
  "braze.com",
  "urbanairship.com",
  "onesignal.com",
  "pushcrew.com",
  "pushwoosh.com",
  "pushbullet.com",
  "pusher.com",
  "pubnub.com",
  "ably.com",
  "stream.io",
  "getstream.io",
  "layer.com",
  "twilio.com",
  "nexmo.com",
  "plivo.com",
  "bandwidth.com",
  "sinch.com",
  "messagebird.com",
  "vonage.com",
  "ringcentral.com",
  "8x8.com",
  "zoom.us",
  "gotomeeting.com",
  "webex.com",
  "bluejeans.com",
  "jitsi.org",
  "whereby.com",
  "appear.in",
  "talky.io",
  "tokbox.com",
  "agora.io",
  "daily.co",
  "mux.com",
  "cloudflare.com",
  "fastly.com",
  "keycdn.com",
  "bunnycdn.com",
  "stackpath.com",
  "maxcdn.com",
  "cdnjs.com",
  "jsdelivr.com",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "ajax.googleapis.com",
  "ajax.aspnetcdn.com",
  "cdn.sstatic.net",
  "sstatic.net",
  "cdn.mathjax.org",
  "cdn.rawgit.com",
  "cdn.ckeditor.com",
  "cdn.tiny.cloud",
  "cdn.quilljs.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
];

/**
 * Setup resource blocking on page
 * Note: Event listener is automatically cleaned up when page is closed
 */
export async function setupResourceBlocking(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  const requestHandler = (request: HTTPRequest) => {
    const resourceType = request.resourceType();
    const url = request.url();

    // Block images, CSS, fonts, media
    if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
      request.abort();
      return;
    }

    // Block subframes (iframes)
    if (resourceType === "subframe") {
      request.abort();
      return;
    }

    // Block tracker domains
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      if (TRACKER_DOMAINS.some((tracker) => hostname.includes(tracker))) {
        request.abort();
        return;
      }
    } catch {
      // Invalid URL, allow it through
    }

    request.continue();
  };

  page.on("request", requestHandler);
}

