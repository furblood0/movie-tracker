/**
 * Gizlilik bildirimi ve kullanim kosullari.
 * Metinler textContent ile yazilir; kullanici verisi HTML'e girmez.
 */

import { el } from './dom.js';

/**
 * @param {{ kind: 'privacy' | 'terms', contactEmail?: string | null }} options
 * @returns {HTMLElement}
 */
export function createLegalView({ kind, contactEmail = null }) {
  const document = kind === 'privacy' ? privacyDocument(contactEmail) : termsDocument();

  return el(
    'article',
    { class: 'prose' },
    el('p', { class: 'page-head__eyebrow label-mono', text: 'Movie Tracker' }),
    el('h1', { class: 'page-head__title', text: document.title }),
    el('p', { class: 'prose__updated label-mono', text: 'Son güncelleme: 8 Ekim 2026' }),
    el('p', { text: document.intro }),
    ...document.sections.map((section) =>
      el(
        'section',
        {},
        el('h2', { text: section.heading }),
        ...section.paragraphs.map((paragraph) => el('p', { text: paragraph })),
      ),
    ),
  );
}

/**
 * @param {string | null} contactEmail
 */
function privacyDocument(contactEmail) {
  const contact = contactEmail
    ? `Yazılı başvurular için: ${contactEmail}`
    : 'Yazılı başvurular, siteyi işleten kişiye iletilir. İletişim adresi yayımlandığında bu sayfada görünür.';

  return {
    title: 'Gizlilik bildirimi',
    intro:
      'Bu metin, Movie Tracker’ı kullandığında hangi verilerin işlendiğini, neden işlendiğini ve bu veriler üzerindeki haklarını anlatır. Günlük kişisel bir defterdir; içeriğin başkalarına açılmaz.',
    sections: [
      {
        heading: 'Veri sorumlusu',
        paragraphs: [
          'Veri sorumlusu, Movie Tracker hizmetini işleten kişidir.',
          contact,
        ],
      },
      {
        heading: 'İşlenen veriler',
        paragraphs: [
          'Hesap: kullanıcı adı, isteğe bağlı e-posta, görünen ad ve şifrenin geri döndürülemez özeti (düz şifre saklanmaz).',
          'Oturum: rastgele oturum kimliği, son görülme zamanı, tarayıcı bilgisi ve IP adresi. Çerezde yalnızca oturum kimliği durur.',
          'Günlük: eklediğin yapımın TMDb kimliği, başlık, özet, afiş yolu, yıl, tür, durum, puan, not, izleme tarihi ve favori işareti.',
          'Güvenlik kayıtları: başarısız giriş denemeleri, hız sınırı için kısa süreli sayaçlar.',
        ],
      },
      {
        heading: 'Neden işlenir',
        paragraphs: [
          'Hesabını açmak, günlüğünü saklamak ve yalnızca sana göstermek için. Bu, hizmetin sözleşmesidir.',
          'Oturumun sürmesi, şifre denemelerinin sınırlanması ve kötüye kullanımın yavaşlatılması için. Bunun dayanağı, hizmeti ayakta tutmaya yönelik meşru menfaattir.',
        ],
      },
      {
        heading: 'Kimlerle paylaşılır',
        paragraphs: [
          'Günlük içeriğin satılmaz ve reklam amacıyla üçüncü kişilere verilmez.',
          'Keşfet ekranında yazdığın arama, film veya dizi detayı için TMDb’ye iletilir. Puanların, notların ve kullanıcı adın bu istekle gitmez. TMDb ABD’de hizmet verir; arama sorgusu yurt dışına çıkar.',
          'Afiş görselleri tarayıcın tarafından image.tmdb.org adresinden yüklenir.',
        ],
      },
      {
        heading: 'Çerez',
        paragraphs: [
          'Zorunlu bir oturum çerezi kullanılır: session_id. HttpOnly ve SameSite=Strict işaretlidir; sayfa betikleri bu çerezi okuyamaz. Oturumun varsayılan süresi 30 gündür. Çıkış yaptığında veya hesabını sildiğinde çerez temizlenir.',
          'Analitik, reklam veya üçüncü taraf çerezi yoktur.',
        ],
      },
      {
        heading: 'Ne kadar saklanır',
        paragraphs: [
          'Hesap verileri ve günlük, hesabın durduğu sürece saklanır.',
          'Hesabını sildiğinde kullanıcı kaydın, oturumların ve günlük kayıtların veritabanından silinir. Sunucuda tutulan bir yedek varsa, o kopya yedek döngüsüyle birlikte kalkar.',
          'Süresi dolmuş oturumlar ve bayatlamış TMDb önbelleği düzenli olarak temizlenir.',
        ],
      },
      {
        heading: 'Hakların',
        paragraphs: [
          'Günlüğünün tamamını Özet sayfasından JSON veya CSV olarak indirebilirsin. Bu, verini taşıma yoludur.',
          'Hesabını uygulama içinden silebilirsin. Silme, şifreni ve kullanıcı adını yeniden ister.',
          'E-posta adresin hesabında kayıtlıysa ve düzeltilmesini istiyorsan, yukarıdaki iletişim yoluyla başvurabilirsin. Başvurular KVKK kapsamındaki erişim, düzeltme, silme ve itiraz haklarını kapsar.',
        ],
      },
    ],
  };
}

function termsDocument() {
  return {
    title: 'Kullanım koşulları',
    intro:
      'Movie Tracker, film ve dizi izleme günlüğü tutman için sunulur. Hesap oluşturarak veya giriş yaparak bu koşulları kabul etmiş olursun.',
    sections: [
      {
        heading: 'Hizmet',
        paragraphs: [
          'Günlük sana özeldir. Başka bir kullanıcının kayıtlarını göremezsin; seninkini de başkası göremez.',
          'Film ve dizi bilgileri TMDb arşivinden gelir. Bu bilgilerde hata veya eksik olabilir. Movie Tracker, TMDb tarafından onaylanmış veya onaylanmış bir ürün değildir.',
        ],
      },
      {
        heading: 'Hesap',
        paragraphs: [
          'Kullanıcı adın ve şifrenin gizliliğinden sen sorumlusun. Şifreni başkasıyla paylaşma.',
          'Kayıt, site sahibinin seçtiği moda göre herkese açık, davet kodlu veya kapalı olabilir.',
          'Hesabını dilediğin zaman silebilirsin. Silinen günlük geri gelmez.',
        ],
      },
      {
        heading: 'Kabul edilmeyen kullanım',
        paragraphs: [
          'Hizmeti, başkasının hesabına girmeye, kotayı zorlamaya veya sunucuyu yormaya yönelik otomatik denemeler için kullanmak yasaktır. Bu tür kullanım hesabın kapatılmasına yol açabilir.',
          'Günlüğe yazdığın notlar senindir. Başkasına ait bir metni kendi notun gibi yaymanın sorumluluğu sana aittir.',
        ],
      },
      {
        heading: 'Sorumluluğun sınırı',
        paragraphs: [
          'Hizmet olduğu gibi sunulur. Kesintisiz veya hatasız çalışacağına dair bir taahhüt yoktur.',
          'Günlüğünü indirmen önerilir. Sunucu arızasında kaybolabilecek veriden doğan dolaylı zararlardan siteyi işleten kişi, yürürlükteki hukukun izin verdiği ölçüde sorumlu değildir.',
        ],
      },
      {
        heading: 'Koşulların değişmesi',
        paragraphs: [
          'Bu metin güncellenirse yeni hali bu sayfada yayımlanır ve üstteki tarih değişir. Hizmeti kullanmaya devam etmen, güncel metni kabul ettiğin anlamına gelir.',
          'Uyuşmazlıklarda Türkiye Cumhuriyeti hukuku uygulanır.',
        ],
      },
    ],
  };
}
