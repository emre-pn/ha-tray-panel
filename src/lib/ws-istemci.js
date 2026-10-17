'use strict';

/**
 * Küçük WebSocket istemcisi (RFC 6455; 1.4.0, o-55/o-56; saf — yalnız `node:` yerleşikleri, Electron'a bağlı değildir).
 *
 * Neden var: Electron ana sürecindeki küresel WebSocket (a) isteğe özel üstbilgi (Cloudflare Access servis jetonu) eklemeye, (b) yalnız
 * Home Assistant ana bilgisayarı için özel kök sertifika (CA) tanımaya ve (c) sertifika parmak izi sabitlemeye izin vermez. Bunun için
 * başka bir paket eklenmedi; yalnız bu üç özelliğin gerektiği bağlantılarda bu istemci kullanılır (baglanti-yoneticisi.js). Hiçbiri
 * tanımlı değilse bugünkü küresel WebSocket aynen kullanılır.
 *
 * ha-ws.js'in kullandığı yüzey: `new Sinif(url)`, addEventListener('message'|'close'|'error'|'open'), send(metin), close(), readyState.
 *
 * Güvenlik
 *  - Sertifika doğrulaması ASLA kapatılmaz. Varsayılan: Node'un normal doğrulaması (+ yalnız bu bağlantı için tanımlı özel CA'lar).
 *    Parmak izi modunda (yaprakDenetle verilmiş) zincir doğrulaması yerine, ayarlanmış parmak izi ile YAPRAK sertifika eşleşmesi aranır
 *    ve eşleşmezse bağlantı yükseltme isteği (üstbilgiler dahil) HİÇ GÖNDERİLMEDEN kapatılır: üstbilgi ya da kimlik sızmaz.
 *  - Yükseltme isteği el sıkışma doğrulandıktan sonra yazılır; yönlendirme izlenmez (101 dışındaki her yanıt hata).
 *  - Üstbilgiler ozel-ustbilgi.js kurallarından yeniden geçirilir (kimlik/bağlantı üstbilgileri ve CR/LF/denetim karakteri reddedilir).
 *  - İleti boyutu sınırlıdır (varsayılan 32 MB); sınır aşılırsa 1009 ile kapatılır. Sunucu çerçevesi maskeli ya da RSV bitli ise
 *    1002 (protokol hatası). Hata olaylarına adres, üstbilgi ya da sertifika ayrıntısı taşınmaz.
 */

const nodeTls = require('node:tls');
const nodeNet = require('node:net');
const nodeCrypto = require('node:crypto');
const { ustbilgileriDogrula } = require('./ozel-ustbilgi');

const BAGLANIYOR = 0;
const ACIK = 1;
const KAPANIYOR = 2;
const KAPALI = 3;

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const EN_COK_BASLIK_BAYT = 16 * 1024;
const EN_COK_MESAJ_BAYT = 32 * 1024 * 1024;
const BAGLANTI_ZAMAN_ASIMI_MS = 15_000;
const KAPANIS_BEKLEME_MS = 3_000;

/**
 * @param {object} [bag]
 * @param {(url: string) => (object|null|Promise<object|null>)} [bag.secenekAl]
 *   bağlantıya özel seçenekler { ustbilgi?: {ad: değer}, ca?: string[] (PEM), yaprakDenetle?: (der: Buffer) => boolean }: ek üstbilgiler,
 *   ek kök sertifikalar ve (parmak izi modunda) yaprak denetimi
 * @returns {Function} WebSocket benzeri sınıf
 */
function wsIstemciSinifiOlustur({
  tls = nodeTls,
  net = nodeNet,
  crypto = nodeCrypto,
  secenekAl = () => null,
  zaman = { setTimeout, clearTimeout },
  baglantiZamanAsimiMs = BAGLANTI_ZAMAN_ASIMI_MS,
  kapanisBeklemeMs = KAPANIS_BEKLEME_MS,
  enCokMesajBayt = EN_COK_MESAJ_BAYT,
} = {}) {
  class OzelWebSocket {
    constructor(url) {
      const u = new URL(url); // geçersizse TypeError (ha-ws.js yakalar)
      if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new TypeError('a ws: or wss: address is required');
      if (u.username || u.password || u.hash) throw new TypeError('address must not carry credentials or a fragment');
      this.url = u.href;
      this.readyState = BAGLANIYOR;
      this._dinleyiciler = new Map();
      this._soket = null;
      this._bitti = false;
      this._elSikismaTamam = false;
      this._elTampon = Buffer.alloc(0);
      this._parcalar = []; // gelen ham veri parçaları
      this._toplam = 0;
      this._parcaTuru = null; // parçalı ileti: 1 metin | 2 ikili
      this._ileti = [];
      this._iletiBoyut = 0;
      this._kapanisAlindi = false;
      this._kapanisGonderildi = false;
      this._kapanisKodu = null;
      this._kapanisNedeni = '';
      this._zamanlayici = null;
      this._beklenenKabul = '';
      setImmediate(() => this._baglan(u)); // dinleyiciler `new`den hemen sonra eklenir
    }

    addEventListener(tur, dinleyici) {
      if (typeof dinleyici !== 'function') return;
      if (!this._dinleyiciler.has(tur)) this._dinleyiciler.set(tur, new Set());
      this._dinleyiciler.get(tur).add(dinleyici);
    }

    removeEventListener(tur, dinleyici) {
      this._dinleyiciler.get(tur)?.delete(dinleyici);
    }

    _yay(tur, ek = {}) {
      const olay = { type: tur, target: this, ...ek };
      for (const d of [...(this._dinleyiciler.get(tur) ?? [])]) {
        try {
          d(olay);
        } catch {
          /* dinleyici hatası bağlantıyı bozmasın */
        }
      }
    }

    _zamanlayiciKur(ms, is) {
      this._zamanlayiciTemizle();
      this._zamanlayici = zaman.setTimeout(() => {
        this._zamanlayici = null;
        is();
      }, ms);
      if (typeof this._zamanlayici?.unref === 'function') this._zamanlayici.unref();
    }

    _zamanlayiciTemizle() {
      if (this._zamanlayici !== null) zaman.clearTimeout(this._zamanlayici);
      this._zamanlayici = null;
    }

    async _baglan(u) {
      if (this._bitti) return;
      let secenek;
      try {
        secenek = (await secenekAl(this.url)) || {}; // söz de olabilir (üstbilgi deposunun açılışta yüklenmesi beklenir)
      } catch {
        this._hata();
        return;
      }
      if (this._bitti) return; // seçenekler beklenirken close() çağrılmış olabilir
      let ek = [];
      if (secenek.ustbilgi && Object.keys(secenek.ustbilgi).length > 0) {
        const d = ustbilgileriDogrula(Object.entries(secenek.ustbilgi).map(([ad, deger]) => ({ ad, deger })));
        if (!d.ok) {
          this._hata(); // geçersiz üstbilgi: bağlanma, kısmen gönderme
          return;
        }
        ek = d.liste;
      }
      const ssl = u.protocol === 'wss:';
      const anaBilgisayar = u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname;
      const kapi = u.port ? Number(u.port) : ssl ? 443 : 80;
      const yaprakDenetle = ssl && typeof secenek.yaprakDenetle === 'function' ? secenek.yaprakDenetle : null;
      let soket;
      try {
        if (ssl) {
          const tlsSecenekleri = { host: anaBilgisayar, port: kapi, ALPNProtocols: ['http/1.1'], minVersion: 'TLSv1.2' };
          if (!net.isIP(anaBilgisayar)) tlsSecenekleri.servername = anaBilgisayar;
          if (Array.isArray(secenek.ca) && secenek.ca.length > 0) {
            tlsSecenekleri.ca = [...(Array.isArray(tls.rootCertificates) ? tls.rootCertificates : []), ...secenek.ca];
          }
          // Parmak izi modu: zincir yerine yaprak parmak izi aranır (aşağıda, HİÇBİR veri yazılmadan önce). Başka hiçbir yerde kapatılmaz.
          if (yaprakDenetle) tlsSecenekleri.rejectUnauthorized = false;
          soket = tls.connect(tlsSecenekleri);
        } else {
          soket = net.connect({ host: anaBilgisayar, port: kapi });
        }
      } catch {
        this._hata();
        return;
      }
      this._soket = soket;
      if (typeof soket.setNoDelay === 'function') soket.setNoDelay(true);
      this._zamanlayiciKur(baglantiZamanAsimiMs, () => this._hata());
      soket.on('error', () => this._hata());
      soket.on('close', () => this._soketKapandi());
      soket.on('data', (parca) => this._veri(parca));
      soket.once(ssl ? 'secureConnect' : 'connect', () => {
        if (this._bitti) return;
        if (yaprakDenetle) {
          let uygun = false;
          try {
            const der = soket.getPeerCertificate(false)?.raw;
            uygun = Buffer.isBuffer(der) && yaprakDenetle(der) === true;
          } catch {
            uygun = false;
          }
          if (!uygun) {
            this._hata(); // yükseltme isteği (üstbilgiler) gönderilmedi
            return;
          }
        }
        const anahtar = crypto.randomBytes(16).toString('base64');
        this._beklenenKabul = crypto.createHash('sha1').update(anahtar + GUID).digest('base64');
        const yol = `${u.pathname || '/'}${u.search || ''}`;
        const satirlar = [
          `GET ${yol} HTTP/1.1`,
          `Host: ${u.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${anahtar}`,
          'Sec-WebSocket-Version: 13',
          ...ek.map(({ ad, deger }) => `${ad}: ${deger}`),
          '',
          '',
        ];
        soket.write(satirlar.join('\r\n'));
      });
    }

    /** Hata: adres/üstbilgi ayrıntısı taşımayan tek bir 'error' olayı, ardından kapanış. */
    _hata() {
      if (this._bitti) return;
      this._yay('error');
      this._bitir(1006, '', false);
    }

    _bitir(kod, neden, temiz) {
      if (this._bitti) return;
      this._bitti = true;
      this.readyState = KAPALI;
      this._zamanlayiciTemizle();
      try {
        this._soket?.destroy();
      } catch {
        /* zaten kapalı */
      }
      this._parcalar = [];
      this._yay('close', { code: kod, reason: neden, wasClean: !!temiz });
    }

    _soketKapandi() {
      this._bitir(this._kapanisKodu ?? 1006, this._kapanisNedeni, this._kapanisAlindi && this._kapanisGonderildi);
    }

    // ---- Veri akışı ----

    _veri(parca) {
      if (this._bitti) return;
      if (!this._elSikismaTamam) {
        this._elTampon = Buffer.concat([this._elTampon, parca]);
        const son = this._elTampon.indexOf('\r\n\r\n');
        if (son < 0) {
          if (this._elTampon.length > EN_COK_BASLIK_BAYT) this._hata();
          return;
        }
        const basliklar = this._elTampon.subarray(0, son).toString('latin1');
        const artan = this._elTampon.subarray(son + 4);
        this._elTampon = Buffer.alloc(0);
        if (!this._elSikismayiDogrula(basliklar)) {
          this._hata();
          return;
        }
        this._elSikismaTamam = true;
        this._zamanlayiciTemizle();
        this.readyState = ACIK;
        this._yay('open');
        if (artan.length > 0) this._cerceveVerisi(artan);
        return;
      }
      this._cerceveVerisi(parca);
    }

    _elSikismayiDogrula(metin) {
      const satirlar = metin.split('\r\n');
      if (!/^HTTP\/1\.1 101(\s|$)/.test(satirlar[0] ?? '')) return false; // yönlendirme ve hata yanıtları dahil: yalnız 101
      const basliklar = {};
      for (const s of satirlar.slice(1)) {
        const i = s.indexOf(':');
        if (i <= 0) return false;
        basliklar[s.slice(0, i).trim().toLowerCase()] = s.slice(i + 1).trim();
      }
      if (String(basliklar.upgrade ?? '').toLowerCase() !== 'websocket') return false;
      if (!String(basliklar.connection ?? '').toLowerCase().split(',').map((p) => p.trim()).includes('upgrade')) return false;
      if (basliklar['sec-websocket-accept'] !== this._beklenenKabul) return false;
      if ('sec-websocket-extensions' in basliklar || 'sec-websocket-protocol' in basliklar) return false; // hiçbiri istenmedi
      return true;
    }

    /** Ham veri parçalarını biriktirir ve tam çerçeveleri işler (büyük çerçevede parçalar yalnız bir kez birleştirilir). */
    _cerceveVerisi(parca) {
      this._parcalar.push(parca);
      this._toplam += parca.length;
      for (;;) {
        if (this._bitti || this._toplam < 2) return;
        const ilk = this._basa(Math.min(this._toplam, 14));
        const fin = (ilk[0] & 0x80) !== 0;
        const rsv = ilk[0] & 0x70;
        const opkod = ilk[0] & 0x0f;
        const maskeli = (ilk[1] & 0x80) !== 0;
        let uz = ilk[1] & 0x7f;
        let baslikBoyu = 2;
        if (rsv !== 0 || maskeli) return this._protokolHatasi(1002);
        if (uz === 126) {
          if (this._toplam < 4) return;
          uz = ilk.readUInt16BE(2);
          baslikBoyu = 4;
        } else if (uz === 127) {
          if (this._toplam < 10) return;
          const buyuk = ilk.readBigUInt64BE(2);
          if (buyuk > BigInt(enCokMesajBayt)) return this._protokolHatasi(1009);
          uz = Number(buyuk);
          baslikBoyu = 10;
        }
        const kontrol = opkod >= 8;
        if (kontrol && (!fin || uz > 125)) return this._protokolHatasi(1002);
        if (!kontrol && this._iletiBoyut + uz > enCokMesajBayt) return this._protokolHatasi(1009);
        if (this._toplam < baslikBoyu + uz) return;
        const yuk = this._tuket(baslikBoyu + uz).subarray(baslikBoyu);
        this._cerceve(fin, opkod, yuk);
      }
    }

    /** İlk n baytı tüketmeden döndürür (gerekirse parçaları birleştirir). */
    _basa(n) {
      if (this._parcalar[0].length < n) this._parcalar = [Buffer.concat(this._parcalar)];
      return this._parcalar[0].subarray(0, n);
    }

    /** İlk n baytı tüketir ve döndürür. */
    _tuket(n) {
      const birlesik = this._parcalar.length === 1 ? this._parcalar[0] : Buffer.concat(this._parcalar);
      this._parcalar = birlesik.length > n ? [birlesik.subarray(n)] : [];
      this._toplam -= n;
      return birlesik.subarray(0, n);
    }

    _cerceve(fin, opkod, yuk) {
      if (opkod === 0x8) return this._kapanisCercevesi(yuk);
      if (opkod === 0x9) {
        if (this.readyState === ACIK) this._cerceveGonder(0xa, yuk);
        return undefined;
      }
      if (opkod === 0xa) return undefined;
      if (opkod === 0x1 || opkod === 0x2) {
        if (this._parcaTuru !== null) return this._protokolHatasi(1002); // önceki ileti bitmeden yeni ileti
        this._parcaTuru = opkod;
      } else if (opkod === 0x0) {
        if (this._parcaTuru === null) return this._protokolHatasi(1002);
      } else {
        return this._protokolHatasi(1002);
      }
      this._ileti.push(Buffer.from(yuk));
      this._iletiBoyut += yuk.length;
      if (!fin) return undefined;
      const tur = this._parcaTuru;
      const veri = Buffer.concat(this._ileti);
      this._parcaTuru = null;
      this._ileti = [];
      this._iletiBoyut = 0;
      if (tur === 0x2) return this._protokolHatasi(1003); // Home Assistant ikili ileti göndermez
      let metin;
      try {
        metin = new TextDecoder('utf-8', { fatal: true }).decode(veri);
      } catch {
        return this._protokolHatasi(1007);
      }
      if (this.readyState === ACIK || this.readyState === KAPANIYOR) this._yay('message', { data: metin });
      return undefined;
    }

    _kapanisCercevesi(yuk) {
      if (this._kapanisAlindi) return; // ilk kapanış çerçevesi geçerlidir (sonrakiler kod/nedeni ezmesin)
      this._kapanisAlindi = true;
      this._kapanisKodu = yuk.length >= 2 ? yuk.readUInt16BE(0) : 1005;
      this._kapanisNedeni = yuk.length > 2 ? yuk.subarray(2).toString('utf8') : '';
      const gonderilecek = !this._kapanisGonderildi;
      this.readyState = KAPANIYOR;
      if (gonderilecek) {
        this._kapanisGonderildi = true;
        try {
          this._soket.end(this._cerceveOlustur(0x8, yuk.length >= 2 ? yuk.subarray(0, 2) : Buffer.alloc(0)));
        } catch {
          /* soket zaten kapalı */
        }
      } else {
        try {
          this._soket.end();
        } catch {
          /* soket zaten kapalı */
        }
      }
      this._zamanlayiciKur(kapanisBeklemeMs, () => this._bitir(this._kapanisKodu, this._kapanisNedeni, true));
    }

    _protokolHatasi(kod) {
      if (this._bitti) return;
      if (this.readyState === ACIK && !this._kapanisGonderildi) {
        this._kapanisGonderildi = true;
        try {
          const k = Buffer.alloc(2);
          k.writeUInt16BE(kod, 0);
          this._soket.write(this._cerceveOlustur(0x8, k));
        } catch {
          /* soket zaten kapalı */
        }
      }
      this._hata();
    }

    // ---- Gönderim ----

    _cerceveOlustur(opkod, yuk) {
      const maske = crypto.randomBytes(4);
      let baslik;
      if (yuk.length < 126) baslik = Buffer.from([0x80 | opkod, 0x80 | yuk.length]);
      else if (yuk.length < 65536) baslik = Buffer.from([0x80 | opkod, 0x80 | 126, yuk.length >> 8, yuk.length & 255]);
      else {
        baslik = Buffer.alloc(10);
        baslik[0] = 0x80 | opkod;
        baslik[1] = 0x80 | 127;
        baslik.writeBigUInt64BE(BigInt(yuk.length), 2);
      }
      const maskeli = Buffer.alloc(yuk.length);
      for (let i = 0; i < yuk.length; i += 1) maskeli[i] = yuk[i] ^ maske[i % 4];
      return Buffer.concat([baslik, maske, maskeli]);
    }

    _cerceveGonder(opkod, yuk) {
      this._soket.write(this._cerceveOlustur(opkod, yuk));
    }

    send(veri) {
      if (this.readyState === BAGLANIYOR) throw new Error('InvalidStateError');
      if (this.readyState !== ACIK) return;
      this._cerceveGonder(0x1, Buffer.from(String(veri), 'utf8'));
    }

    close(kod = 1000, neden = '') {
      if (this.readyState === KAPALI || this.readyState === KAPANIYOR) return;
      if (this.readyState === BAGLANIYOR) {
        this._bitir(1006, '', false);
        return;
      }
      this.readyState = KAPANIYOR;
      this._kapanisGonderildi = true;
      const nedenBaytlari = Buffer.from(String(neden), 'utf8').subarray(0, 123);
      const yuk = Buffer.alloc(2 + nedenBaytlari.length);
      yuk.writeUInt16BE(Number.isInteger(kod) ? kod : 1000, 0);
      nedenBaytlari.copy(yuk, 2);
      try {
        this._cerceveGonder(0x8, yuk);
      } catch {
        /* soket zaten kapalı */
      }
      this._zamanlayiciKur(kapanisBeklemeMs, () => this._bitir(1006, '', false));
    }
  }

  OzelWebSocket.CONNECTING = BAGLANIYOR;
  OzelWebSocket.OPEN = ACIK;
  OzelWebSocket.CLOSING = KAPANIYOR;
  OzelWebSocket.CLOSED = KAPALI;
  return OzelWebSocket;
}

module.exports = { wsIstemciSinifiOlustur, EN_COK_MESAJ_BAYT, BAGLANTI_ZAMAN_ASIMI_MS, KAPANIS_BEKLEME_MS };
