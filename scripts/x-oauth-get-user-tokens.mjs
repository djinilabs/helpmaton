#!/usr/bin/env node
/**
 * One-time script to obtain X (Twitter) OAuth 1.0a Access Token and Access Token Secret
 * for the "Tweet on new PR" workflow. The X Developer Portal only shows Consumer Key,
 * Consumer Secret, and Bearer Token; posting as a user requires the 3-legged OAuth flow.
 *
 * Usage:
 *   node scripts/x-oauth-get-user-tokens.mjs
 *   X_API_KEY=xxx X_API_SECRET=yyy node scripts/x-oauth-get-user-tokens.mjs
 *
 * You will be prompted to open the authorization URL, log in as the Helpmaton account,
 * then enter the 7-digit PIN. The script prints X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET
 * to add as GitHub repository secrets.
 */

import crypto from "crypto";
import https from "https";
import readline from "readline";

const TWITTER = "https://api.twitter.com";

function oauthEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function hmacSha1(key, data) {
  return crypto.createHmac("sha1", key).update(data).digest("base64");
}

function randomNonce() {
  return crypto.randomBytes(32).toString("base64url").replace(/[^a-zA-Z0-9]/g, "");
}

function buildAuthHeader(method, url, params, consumerSecret, tokenSecret = "") {
  const oauthParams = {
    oauth_consumer_key: params.oauth_consumer_key,
    oauth_nonce: params.oauth_nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: params.oauth_timestamp,
    oauth_version: "1.0",
    ...(params.oauth_callback !== undefined && { oauth_callback: params.oauth_callback }),
    ...(params.oauth_token !== undefined && { oauth_token: params.oauth_token }),
    ...(params.oauth_verifier !== undefined && { oauth_verifier: params.oauth_verifier }),
  };
  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${oauthEncode(k)}=${oauthEncode(oauthParams[k])}`)
    .join("&");
  const baseString = [
    method,
    oauthEncode(url),
    oauthEncode(paramString),
  ].join("&");
  const signingKey = `${oauthEncode(consumerSecret)}&${oauthEncode(tokenSecret)}`;
  const signature = hmacSha1(signingKey, baseString);
  const headerParams = { ...oauthParams, oauth_signature: signature };
  const header =
    "OAuth " +
    Object.entries(headerParams)
      .map(([k, v]) => `${oauthEncode(k)}="${oauthEncode(v)}"`)
      .join(", ");
  return header;
}

function post(url, authHeader) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            return;
          }
          const parsed = Object.fromEntries(
            body.split("&").map((p) => {
              const [k, v] = p.split("=");
              return [decodeURIComponent(k), decodeURIComponent(v || "")];
            })
          );
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function question(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let consumerKey = process.env.X_API_KEY;
  let consumerSecret = process.env.X_API_SECRET;
  if (!consumerKey) {
    consumerKey = await question(rl, "Enter Consumer Key (X_API_KEY): ");
  }
  if (!consumerSecret) {
    consumerSecret = await question(rl, "Enter Consumer Secret (X_API_SECRET): ");
  }
  if (!consumerKey?.trim() || !consumerSecret?.trim()) {
    console.error("Consumer Key and Consumer Secret are required.");
    process.exit(1);
  }
  consumerKey = consumerKey.trim();
  consumerSecret = consumerSecret.trim();

  const requestTokenUrl = `${TWITTER}/oauth/request_token`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomNonce();
  const authHeader = buildAuthHeader(
    "POST",
    requestTokenUrl,
    {
      oauth_consumer_key: consumerKey,
      oauth_nonce: nonce,
      oauth_timestamp: timestamp,
      oauth_callback: "oob",
    },
    consumerSecret
  );

  console.log("Requesting request token...");
  let tokenResponse;
  try {
    tokenResponse = await post(requestTokenUrl, authHeader);
  } catch (err) {
    console.error("Request token failed:", err.message);
    process.exit(1);
  }
  const requestToken = tokenResponse.oauth_token;
  const requestTokenSecret = tokenResponse.oauth_token_secret;
  if (!requestToken || !requestTokenSecret) {
    console.error("Unexpected response:", tokenResponse);
    process.exit(1);
  }

  const authUrl = `${TWITTER}/oauth/authorize?oauth_token=${requestToken}`;
  console.log("\n1. Open this URL in your browser (log in as the Helpmaton account and authorize):");
  console.log(authUrl);
  console.log("\n2. Enter the 7-digit PIN shown after you authorize:\n");
  const pin = (await question(rl, "PIN: ")).trim();
  rl.close();

  const accessTokenUrl = `${TWITTER}/oauth/access_token`;
  const timestamp2 = Math.floor(Date.now() / 1000).toString();
  const nonce2 = randomNonce();
  const authHeader2 = buildAuthHeader(
    "POST",
    accessTokenUrl,
    {
      oauth_consumer_key: consumerKey,
      oauth_nonce: nonce2,
      oauth_timestamp: timestamp2,
      oauth_token: requestToken,
      oauth_verifier: pin,
    },
    consumerSecret,
    requestTokenSecret
  );

  console.log("Exchanging PIN for access token...");
  let accessResponse;
  try {
    accessResponse = await post(accessTokenUrl, authHeader2);
  } catch (err) {
    console.error("Access token request failed:", err.message);
    process.exit(1);
  }
  const accessToken = accessResponse.oauth_token;
  const accessTokenSecret = accessResponse.oauth_token_secret;
  if (!accessToken || !accessTokenSecret) {
    console.error("Unexpected response:", accessResponse);
    process.exit(1);
  }

  console.log("\nAdd these as GitHub repository secrets:\n");
  console.log("  X_ACCESS_TOKEN        =", accessToken);
  console.log("  X_ACCESS_TOKEN_SECRET =", accessTokenSecret);
  console.log("\nYou already have X_API_KEY (Consumer Key) and X_API_SECRET (Consumer Secret).");
  console.log("All four are required for the Tweet on new PR workflow.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
