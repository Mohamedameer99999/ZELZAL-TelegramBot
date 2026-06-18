const db = require('./database.js');
db.init();
const licenses = db.getActiveLicenses();
console.log('Active licenses:', licenses.length);
licenses.forEach(l => {
  const h = Math.ceil((new Date(l.expires_at.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) - new Date()) / (1000*60*60));
  console.log(l.license_key.substring(0,20), '|', l.product, '|', h, 'hours left');
});
db.close();
