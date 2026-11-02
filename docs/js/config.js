// Adres API (Cloudflare Worker). Jesli wdrazasz wlasnego workera, wpisz tu jego adres.
// Na localhost strona gada z lokalnym workerem (npm run dev w folderze worker).
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
window.MTS_CONFIG = {
  api: local ? 'http://localhost:8787' : 'https://minecraft-trade-shop.mikolaj1657.workers.dev',
};
