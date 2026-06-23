// api/products.js
// Vercel Serverless Function — fetches electronics products from CJ
// CJ listV2 requires POST with JSON body

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

async function getAccessToken(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const tokenRes = await fetch(`${protocol}://${host}/api/cj-token`);
  const tokenData = await tokenRes.json();
  if (!tokenData.accessToken) throw new Error('Could not get CJ access token');
  return tokenData.accessToken;
}

function calculateSellPrice(cost) {
  if (!cost || cost === 0) return 29.99;
  const raw = cost * 2.5;
  return Math.floor(raw) + 0.99;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const accessToken = await getAccessToken(req);

    const { keyword = '', pageNum = 1, pageSize = 20 } = req.query;

    // CJ listV2 uses POST with JSON body
    const body = {
      pageNum: parseInt(pageNum),
      pageSize: parseInt(pageSize),
      productNameEn: keyword || 'bluetooth',
    };

    const cjRes = await fetch(`${CJ_BASE}/product/listV2`, {
      method: 'POST',
      headers: {
        'CJ-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const cjData = await cjRes.json();

    // Log for debugging
    console.log('CJ response code:', cjData.code, 'message:', cjData.message);

    if (cjData.code !== 200) {
      return res.status(502).json({
        error: 'CJ API error',
        code: cjData.code,
        details: cjData.message,
      });
    }

    const list = cjData.data?.list || [];

    const products = list.map((p) => ({
      id: p.pid,
      sku: p.productSku,
      name: p.productNameEn,
      image: p.productImage,
      category: p.categoryName || 'Electronics',
      costPrice: parseFloat(p.sellPrice || 0),
      sellPrice: calculateSellPrice(parseFloat(p.sellPrice || 0)),
      description: p.description || '',
      variants: (p.variants || []).map((v) => ({
        vid: v.vid,
        name: v.variantNameEn,
        sku: v.variantSku,
        price: parseFloat(v.variantSellPrice || 0),
      })),
    }));

    return res.status(200).json({
      success: true,
      total: cjData.data?.total || 0,
      page: parseInt(pageNum),
      pageSize: parseInt(pageSize),
      products,
    });

  } catch (err) {
    console.error('products handler error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
