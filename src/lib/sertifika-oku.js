'use strict';

/**
 * Sunucunun sunduğu sertifikayı OKUR (1.4.0, o-56; "sunucu sertifikasını oku" düğmesi). Yalnızca TLS el sıkışması yapar, sonra bağlantıyı
 * keser: sokete HİÇBİR veri yazılmaz (istek, üstbilgi, anahtar yok). Amaç kullanıcıya parmak izini göstermektir; sabitleme ancak kullanıcı
 * parmak izini kendi bildiğiyle karşılaştırıp onaylayınca yapılır (ayrı bir adım).
 *
 * Bu, sertifika hatasını "yok saymak" değildir: bağlantı hiçbir işe yaramaz (veri taşımaz), dönen değer yalnız bir parmak izi ve özettir.
 * `rejectUnauthorized: false` yalnız bu okuma içindir; HA'ya giden gerçek istekler normal ya da sabitlemeli doğrulamadan geçer.
 */

const nodeTls = require('node:tls');
const nodeNet = require('node:net');

const ZAMAN_ASIMI_MS = 8000;

/**
 * @param {object} bag
 * @param {string} bag.anaBilgisayar
 * @param {number} bag.kapi
 * @returns {Promise<{ ok: true, der: Buffer, sistemGuveniyor: boolean } | { ok: false, neden: 'baglanamadi'|'zaman-asimi'|'sertifika-yok' }>}
 */
function sunucuSertifikasiniOku({ anaBilgisayar, kapi, tls = nodeTls, net = nodeNet, zamanAsimiMs = ZAMAN_ASIMI_MS }) {
  return new Promise((coz) => {
    let bitti = false;
    let soket = null;
    const bitir = (sonuc) => {
      if (bitti) return;
      bitti = true;
      clearTimeout(zamanlayici);
      try {
        if (soket) soket.destroy();
      } catch {
        // kapanış hatası önemsiz
      }
      coz(sonuc);
    };
    const zamanlayici = setTimeout(() => bitir({ ok: false, neden: 'zaman-asimi' }), zamanAsimiMs);
    try {
      const secenek = { host: anaBilgisayar, port: kapi, minVersion: 'TLSv1.2', rejectUnauthorized: false };
      if (!net.isIP(anaBilgisayar)) secenek.servername = anaBilgisayar;
      soket = tls.connect(secenek);
    } catch {
      bitir({ ok: false, neden: 'baglanamadi' });
      return;
    }
    soket.once('secureConnect', () => {
      let sertifika = null;
      try {
        sertifika = soket.getPeerCertificate(false);
      } catch {
        sertifika = null;
      }
      const der = sertifika && Buffer.isBuffer(sertifika.raw) ? sertifika.raw : null;
      if (!der) bitir({ ok: false, neden: 'sertifika-yok' });
      else bitir({ ok: true, der, sistemGuveniyor: soket.authorized === true });
    });
    soket.once('error', () => bitir({ ok: false, neden: 'baglanamadi' }));
    soket.once('close', () => bitir({ ok: false, neden: 'baglanamadi' }));
  });
}

module.exports = { sunucuSertifikasiniOku };
