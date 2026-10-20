const token = process.env.ACME_TOKEN;
const baseUrl = process.env.ACME_API_URL ?? 'https://api.example.com';
const debug = process.env.ACME_DEBUG === '1';

console.log('acme', token ? 'authenticated' : 'anonymous', baseUrl, debug);
