// api/orders.js
// Vercel Serverless Function — two jobs:
//   POST /api/orders  → saves order to Supabase + creates CJ fulfillment order
//   GET  /api/orders  → lists orders from Supabase (admin use)

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const SUPABASE_URL = 'https://mtxtqsjsayatgvxqlnuc.supabase.co';

async function getAccessToken(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const tokenRes = await fetch(`${protocol}://${host}/api/cj-token`);
  const tokenData = await tokenRes.json();
  if (!tokenData.accessToken) throw new Error('Could not get CJ access token');
  return tokenData.accessToken;
}

// Save order to Supabase
async function saveToSupabase(orderData) {
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(orderData),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Supabase error: ${JSON.stringify(data)}`);
  return data[0];
}

// Create fulfillment order in CJ
async function createCJOrder(accessToken, order) {
  // Map customer address to CJ format
  const cjOrderPayload = {
    orderNumber: `TD-${Date.now()}`,  // TechDrop order number
    shippingCountryCode: 'US',        // Default — extend later for international
    shippingPhone: order.phone,
    shippingCustomerName: order.customer_name,
    shippingAddress: order.address,
    remark: `TechDrop order — USDT payment`,
    products: order.cjProducts.map((p) => ({
      vid: p.vid,           // CJ variant ID
      quantity: p.quantity,
      shippingName: 'CJPacket Super Pure', // fast + tracked
    })),
  };

  const res = await fetch(`${CJ_BASE}/shopping/order/createOrderV2`, {
    method: 'POST',
    headers: {
      'CJ-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cjOrderPayload),
  });

  const data = await res.json();
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ─── POST: Place new order ────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = req.body;

      // Validate required fields
      const required = ['customer_name', 'email', 'phone', 'address', 'items', 'total'];
      for (const field of required) {
        if (!body[field]) {
          return res.status(400).json({ error: `Missing required field: ${field}` });
        }
      }

      // 1. Save to Supabase first (always — even if CJ fails)
      const supabaseOrder = await saveToSupabase({
        customer_name: body.customer_name,
        email: body.email,
        phone: body.phone,
        address: body.address,
        items: body.items,
        total: body.total,
        payment_method: 'USDT TRC20',
        status: 'pending',
      });

      // 2. If CJ product variant IDs included, auto-fulfill with CJ
      let cjOrderResult = null;
      if (body.cjProducts && body.cjProducts.length > 0) {
        try {
          const accessToken = await getAccessToken(req);
          cjOrderResult = await createCJOrder(accessToken, body);
        } catch (cjErr) {
          // Don't fail the whole order if CJ fulfillment fails
          // Order is already saved to Supabase — you can fulfill manually
          console.error('CJ fulfillment error (order still saved):', cjErr);
        }
      }

      return res.status(200).json({
        success: true,
        orderId: supabaseOrder?.id,
        message: 'Order placed successfully',
        cjOrder: cjOrderResult?.data || null,
        cjStatus: cjOrderResult?.result ? 'fulfilled' : 'manual_needed',
      });

    } catch (err) {
      console.error('orders POST error:', err);
      return res.status(500).json({ error: 'Failed to place order', message: err.message });
    }
  }

  // ─── GET: List orders (simple admin check) ────────────────────────────────
  if (req.method === 'GET') {
    try {
      const supabaseKey = process.env.SUPABASE_ANON_KEY;

      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?order=created_at.desc&limit=50`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
        }
      );

      const orders = await res2.json();
      return res.status(200).json({ success: true, orders });

    } catch (err) {
      console.error('orders GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
