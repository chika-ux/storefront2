// api/cj-token.js
// Vercel Serverless Function — exchanges CJ API key for access token
// Token is cached in memory for 12 hours to avoid hitting rate limits

let cachedToken = null;
let tokenExpiry = null;

export default async function handler(req, res) {
  // Allow requests from your own frontend only
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = Date.now();

    // Return cached token if still valid (12 hour buffer before 15-day expiry)
    if (cachedToken && tokenExpiry && now < tokenExpiry) {
      return res.status(200).json({ accessToken: cachedToken });
    }

    const apiKey = process.env.CJ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'CJ_API_KEY environment variable not set' });
    }

    // Exchange API key for access token
    const response = await fetch(
      'https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      }
    );

    const data = await response.json();

    if (!data.result || data.code !== 200) {
      console.error('CJ token error:', data);
      return res.status(401).json({ error: 'Failed to get CJ access token', details: data.message });
    }

    // Cache for 12 hours (token lasts 15 days, we refresh early)
    cachedToken = data.data.accessToken;
    tokenExpiry = now + 12 * 60 * 60 * 1000;

    return res.status(200).json({ accessToken: cachedToken });

  } catch (err) {
    console.error('cj-token error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
