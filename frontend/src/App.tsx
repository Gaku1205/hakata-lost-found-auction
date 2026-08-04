import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RequireAdmin, RequireAuth, RequireOrg } from './components/RequireAdmin';
import { AdminCloudFormation } from './pages/admin/AdminCloudFormation';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminInquiries } from './pages/admin/AdminInquiries';
import { AdminItems } from './pages/admin/AdminItems';
import { AdminOrganizations } from './pages/admin/AdminOrganizations';
import { AdminPartnerApplications } from './pages/admin/AdminPartnerApplications';
import { BidMonitor } from './pages/admin/BidMonitor';
import { Home } from './pages/Home';
import { ItemDetail } from './pages/ItemDetail';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { MyPage } from './pages/MyPage';
import { OrgContact } from './pages/org/OrgContact';
import { OrgItemForm } from './pages/org/OrgItemForm';
import { OrgItems } from './pages/org/OrgItems';
import { OrgRevenue } from './pages/org/OrgRevenue';
import { PartnerApply } from './pages/PartnerApply';
import { SignUp } from './pages/SignUp';

const ScrollToTop = (): null => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

type ImageCredit = {
  item: string;
  title: string;
  author: string;
  license: string;
  url: string;
};

const IMAGE_CREDITS: readonly ImageCredit[] = [
  { item: '折りたたみ傘', title: 'Folding umbrella 01', author: 'Kritzolina', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Folding_umbrella_01.jpg' },
  { item: 'ビニール傘', title: 'Umbrella', author: 'Jennifer Feuchter', license: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Umbrella_(2297730832).jpg' },
  { item: '二つ折り財布', title: 'Leather Wallet with a Strap Closure', author: 'Cooper Hewitt, Smithsonian Design Museum (DPLA)', license: 'No restrictions', url: 'https://commons.wikimedia.org/wiki/File:Leather_Wallet_with_a_Strap_Closure_-_DPLA_-_01e1cfae03bc0ce9106a5a7d5e4a9981_(page_1).jpg' },
  { item: '腕時計（アナログ）', title: 'Citizen Quartz two-tone wristwatch with date window', author: 'A S M Jobaer', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Citizen_Quartz_two-tone_wristwatch_with_date_window.jpg' },
  { item: 'ワイヤレスイヤホン', title: 'Technics EAH-AZ60M2', author: 'RuinDig / Yuki Uchida', license: 'CC BY 4.0', url: 'https://commons.wikimedia.org/wiki/File:Technics-EAH-AZ60M2_13.jpg' },
  { item: 'シティサイクル', title: 'Brosen city bicycle', author: 'Brosen', license: 'CC BY 2.5', url: 'https://commons.wikimedia.org/wiki/File:Brosen_city_bicycle.jpg' },
  { item: 'キャリーケース', title: 'Samsonite Pro-DLX 4 Rolling Tote 16.4 Inch Black', author: 'Florian Fuchs', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Samsonite_Pro-DLX_4_Rolling_Tote_16.4_Inch_Black.jpg' },
  { item: 'トートバッグ', title: 'Canvas two-tone tote Navy and Natural', author: 'Tom Beatty', license: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Canvas_two-tone_tote_Navy_and_Natural7_(9038437258).jpg' },
  { item: 'カーディガン', title: 'Brown Wool Knit Cardigan Sweater of Charles Lindbergh', author: 'Piqua Hosiery Co (DPLA)', license: 'Public domain', url: 'https://commons.wikimedia.org/wiki/File:Brown_Wool_Knit_Cardigan_Sweater_of_Charles_Lindbergh_-_DPLA_-_c76bd59b2824736409a2eb2dbbfb58b3_(page_2).jpg' },
  { item: 'ネックレス', title: "Magpie's Nest - silver necklace side view", author: 'W.carter', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Magpie%27s_Nest_-_silver_necklace_side_view.jpg' },
  { item: '文庫本セット', title: 'Book sale loot', author: 'Ginny (USA)', license: 'CC BY-SA 2.0', url: 'https://commons.wikimedia.org/wiki/File:Book_sale_loot_(4552277923).jpg' },
  { item: '折りたたみ自転車', title: 'Brompton1', author: 'Wikimedia Commons', license: 'Copyrighted free use', url: 'https://commons.wikimedia.org/wiki/File:Brompton1.jpeg' },
  { item: '腕時計（クロノグラフ）', title: 'Certina DS Podium', author: 'NobleK', license: 'CC BY-SA 3.0', url: 'https://commons.wikimedia.org/wiki/File:Certina_DS_Podium.jpg' },
  { item: 'ショルダーバッグ', title: 'Black Leather Hermes Shoulder Bag', author: 'Indianapolis Museum of Art (DPLA)', license: 'No restrictions', url: 'https://commons.wikimedia.org/wiki/File:Black_Leather_Hermes_Shoulder_Bag_-_DPLA_-_0b27d01782af4c0fe73446eebd53b05a_(page_1).jpg' },
  { item: '折りたたみ傘（黒無地）', title: 'A close-up view of a folded black umbrella with red trim tucked behind a wooden surface, showing its textured black-and-red handle.', author: 'Alina Kakshapati', license: 'CC0 1.0', url: 'https://wordpress.org/photos/photo/8266a12c57/' },
  { item: '長傘（ビニール・大きめ）', title: '雨・・・', author: 'kalleboo', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/82365211@N00/7478849526' },
  { item: '折りたたみ傘（花柄・ミニサイズ）', title: 'Pink umbrellas', author: 'Infomastern', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/55856449@N04/15068341634' },
  { item: '長傘（紳士用・黒無地）', title: 'black umbrella', author: 'eschipul', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/16638697@N00/5468700106' },
  { item: '折りたたみ傘（迷彩柄）', title: 'the green umbrella', author: 'nancy_t3i', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/67402186@N05/6138868947' },
  { item: 'ビニール傘（骨折れあり）', title: 'Broken Umbrellas in a Bin', author: 'jeffdjevdet', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/126917537@N03/28414068936' },
  { item: '長財布（黒・レザー）', title: 'gucci-men-wallet-logo-silver-plate-black-leather-bi-fold-wallet-gg1152kcaweb', author: 'unknown (Flickr)', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/62997622@N03/5934254738' },
  { item: '二つ折り財布（グレー・合皮）', title: 'Calculator - Exactus Mini-Add, Pocket Model, circa 1950', author: 'Photographer: Deborah Tout-Smith', license: 'CC BY 4.0', url: 'https://collections.museumsvictoria.com.au/items/2172655' },
  { item: 'ミニ財布（コインケース一体型・赤）', title: 'red wallet', author: '[cipher]', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/36521954194@N01/4062694515' },
  { item: '長財布（ネイビー・ナイロン）', title: 'karins leather wallet', author: 'michael pollak', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/22294215@N06/8547342013' },
  { item: 'カードケース（本革・茶）', title: 'Leather Business Card Holder with ID Window', author: 'unknown (Flickr)', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/2797/4093258217' },
  { item: '腕時計（デジタル・黒）', title: "Casio G-Shock 'Zombie Slayer'", author: 'GuySie', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/76491533@N00/5090839386' },
  { item: '腕時計（レディース・ゴールド）', title: 'Gold watch', author: 'quinet', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/91994044@N00/10990296794' },
  { item: '腕時計（スポーツウォッチ・ラバーベルト）', title: 'Sicura GLOBETROTTER GMT front view', author: 'Pierangelo', license: 'CC BY 4.0', url: 'https://commons.wikimedia.org/w/index.php?curid=194862910' },
  { item: '腕時計（アンティーク調・革ベルト）', title: 'Marina Militare Radiomir 1936 Panatime strap #1', author: 'GuySie', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/76491533@N00/3142307827' },
  { item: '腕時計（防水デジタル・黒）', title: 'Geonaute digital sports watches', author: 'Alan Levine', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/5322/9660587229' },
  { item: '有線イヤホン（白）', title: 'headphones', author: 'Mervi Emilia', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/14394039@N00/9799414946' },
  { item: 'ワイヤレスイヤホン（片耳のみ）', title: '2023 (365 challenge) - Week 6 (Colour on same colour) - Day 2 - black earbuds on black', author: 'ambabheg', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/31518985@N04/52670318598' },
  { item: 'ヘッドホン（オーバーイヤー・黒）', title: 'Bluetooth Over Ear Headphones, OneOdio Wired Gaming Stereo Headsets w/Detachable Mic for PS4, Xbox one, PC, Cell Phones, Office, Wireless Headset w/ 30 Hrs Play Time - Studio Wireless(Y80B)', author: 'shop8447', license: 'CC0 1.0', url: 'https://www.flickr.com/photos/185514373@N06/49062403237' },
  { item: 'ワイヤレススピーカー（小型）', title: 'Neues #Gadget im Haus: Der #Swimmer von @boommovement. (#blau #blue #wasserfest #waterproof #bluetooth #speaker)', author: 'achimh', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/8599338@N04/16299625682' },
  { item: 'ワイヤレスイヤホン（ケースのみ・本体なし）', title: 'Here One earbuds in white charging case', author: 'Doppler Labs', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/w/index.php?curid=63803093' },
  { item: 'イヤホン（有線・巻き取り式）', title: 'Hello Kitty MP3 Player (package)', author: 'liewcf', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/34353636@N00/1342988344' },
  { item: 'マウンテンバイク風自転車（27インチ）', title: 'Mountain Bike 01', author: 'jtbradford', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/99623414@N00/6125467033' },
  { item: '電動アシスト自転車（バッテリー別売）', title: 'Electric Bicycle', author: 'Mikefairbanks', license: 'CC BY-SA 3.0', url: 'https://commons.wikimedia.org/w/index.php?curid=24725803' },
  { item: 'ミニベロ（20インチ・折りたたみ不可）', title: 'Dahon Jifo 16 Folding Bike', author: 'Dahon North America Inc.', license: 'CC BY-SA 3.0', url: 'https://commons.wikimedia.org/w/index.php?curid=20101000' },
  { item: '子供用自転車（16インチ）', title: 'Kids bicycle', author: 'bitjungle', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/54318649@N00/4174888878' },
  { item: 'シティサイクル（カゴ破損）', title: 'Resistant', author: 'Go-tea 郭天', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/131814204@N04/34067213203' },
  { item: 'リュックサック（黒・ビジネス用）', title: 'Incase ICON Pack', author: 'Incase.', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/62021300@N00/13761593095' },
  { item: 'ハンドバッグ（レディース・白）', title: 'Coach White Handbag. Location unknown', author: 'rawpixel', license: 'CC0 1.0', url: 'https://www.rawpixel.com/image/6111449/photo-image-public-domain-fashion-white' },
  { item: 'ボストンバッグ（旅行用・紺）', title: 'Bags', author: 'christian.senger', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/30928442@N08/4111099731' },
  { item: 'ウエストポーチ（黒・ナイロン）', title: 'Leather Fanny Pack', author: 'Plot Spoiler', license: 'CC BY-SA 3.0', url: 'https://commons.wikimedia.org/w/index.php?curid=15963035' },
  { item: 'エコバッグ（保冷機能付き）', title: 'BALORAY Lunch Bag Tote Bag Lunch Bag for Women Lunch Box Insulated Lunch Container', author: 'shop8447', license: 'CC0 1.0', url: 'https://www.flickr.com/photos/185514373@N06/49061132756' },
  { item: '巾着袋（和柄・小物入れ）', title: 'shoes bag', author: 'myu_myu', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/76247290@N03/6982275736' },
  { item: 'マフラー（ウール・グレー）', title: 'gray wool scarf', author: 'andrewtoskin', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/100030176@N02/14933353244' },
  { item: '手袋（革・黒・片方のみ）', title: 'Leather gloves', author: 'el cajon yacht club', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/60944636@N00/41485371462' },
  { item: 'パーカー（グレー・Lサイズ）', title: 'woman in grey pullover hoodie holding red and black disposable cup', author: 'unknown (Flickr)', license: 'CC BY 2.0', url: 'https://live.staticflickr.com/65535/40713535533_2e5544ef6f_b.jpg' },
  { item: 'ストール（シルク調・花柄）', title: 'Black Taylor Dress and Floral Scarf-1', author: 'Tara_St', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/71270343@N07/26333821226' },
  { item: 'ジャケット（デニム・Mサイズ）', title: "Levi's denim jacket", author: 'CastawayVintage', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/44483053@N05/5051612535' },
  { item: '帽子（キャップ・黒）', title: "DFC_0098: a woman wearing a black baseball cap with 'THAILAND' visible on it", author: 'PattayaPatrol', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/194424926@N05/54544970087' },
  { item: 'ピアス（片方のみ・シルバー）', title: '1.00 Ct Round 5mm Green Chrome Diopside 925 Sterling Silver Stud Earrings', author: 'topjerry', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/126139641@N04/14880759163' },
  { item: 'ブレスレット（ビーズ）', title: 'Chakra bracelet on marble beads', author: 'rawpixel', license: 'CC0 1.0', url: 'https://www.rawpixel.com/image/11524366/chakra-bracelet-marble-beads' },
  { item: 'サングラス（黒縁）', title: 'black sunglasses, black & yellow leather wristband', author: 'stevendamron', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/97719890@N00/3962852476' },
  { item: '指輪（シンプルリング）', title: 'Shiny Things', author: 'goblinbox_(queen_of_ad_hoc_bento)', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/25977089@N00/15923800621' },
  { item: 'ネクタイピン（シルバー）', title: 'silver tie clips', author: 'Mauro Cateb', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/69102917@N06/52344420709' },
  { item: 'ヘアアクセサリー（バレッタ3点セット）', title: 'Hair Flower Rainbow', author: 'Jenn Durfey', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/52498245@N03/7819360428' },
  { item: 'ビジネス書2冊セット', title: 'Bottom shelf. #books', author: 'kiwanja', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/47778386@N00/8654265441' },
  { item: '漫画コミックセット（10冊）', title: 'Manga books', author: 'Ruth and Dave', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/95142644@N00/6151046815' },
  { item: '旅行ガイドブック（福岡版）', title: '창 넓은 커피숍에서 다음 여행을 꿈꾸며... #Seoul #Starbucks #Coffee #Travel #Guidebook #Lonely #Planet', author: 'IchStyle', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/66172503@N00/17298911955' },
  { item: '参考書・問題集セット（高校生用）', title: 'Two parallel stacks of books on blue background', author: 'Horia Varlan', license: 'CC BY 2.0', url: 'https://www.flickr.com/photos/10361931@N06/4263328317' },
  { item: '洋書ペーパーバック', title: '“When I stepped out into the bright sunlight from the darkness of the movie house, I had only two things on my mind: Paul Newman and a ride home.”', author: 'TheeErin', license: 'CC BY-SA 2.0', url: 'https://www.flickr.com/photos/27073477@N00/3319626950' },
];

const NotFound = (): JSX.Element => (
  <div className="container section">
    <h1 className="page-title">ページが見つかりません</h1>
    <p className="page-lead">お探しのページは存在しないか、移動した可能性があります。</p>
    <Link className="btn btn--primary btn--fit" to="/items">
      出品一覧へ戻る
    </Link>
  </div>
);

const UserMenu = (): JSX.Element => {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();

  if (state.status === 'loading') {
    return <span className="user-menu" aria-hidden="true" />;
  }

  if (state.status === 'anon') {
    return (
      <div className="user-menu">
        <NavLink to="/login" className="site-nav__link">
          ログイン
        </NavLink>
      </div>
    );
  }

  return (
    <div className="user-menu">
      <span className="user-menu__name" title={state.user.email}>
        {state.user.nickname} さん
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={() => {
          signOut();
          navigate('/');
        }}
      >
        ログアウト
      </button>
    </div>
  );
};

const Header = (): JSX.Element => {
  const { state } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAuthed = state.status === 'authed';
  const isAdmin = isAuthed && state.user.isAdmin;
  const isOrg = isAuthed && state.user.isOrg;

  // ページ遷移でドロワーを閉じる
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand" aria-label="めぐりモノ ホーム">
          <span className="brand__mark" aria-hidden="true">
            め
          </span>
          <span className="brand__name">めぐりモノ</span>
        </Link>

        <button
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>

        <div id="site-menu" className={`site-menu${menuOpen ? ' site-menu--open' : ''}`}>
          <nav className="site-nav" aria-label="メインナビゲーション">
            <NavLink to="/items" className="site-nav__link">
              出品一覧
            </NavLink>
            <NavLink to="/partners/apply" className="site-nav__link">
              企業の方へ
            </NavLink>
            {isAuthed && !isOrg ? (
              <NavLink to="/mypage" className="site-nav__link">
                マイページ
              </NavLink>
            ) : null}
            {isOrg ? (
              <NavLink to="/org" className="site-nav__link site-nav__link--admin">
                出品元管理画面
              </NavLink>
            ) : null}
            {isAdmin ? (
              <NavLink to="/admin" className="site-nav__link site-nav__link--admin">
                管理画面
              </NavLink>
            ) : null}
          </nav>
          <UserMenu />
          <span className="demo-badge">デモ環境・模擬データ</span>
        </div>
      </div>
    </header>
  );
};

export const App = (): JSX.Element => (
  <>
    <a href="#main" className="skip-link">
      本文へスキップ
    </a>
    <ScrollToTop />
    <Header />

    <main id="main">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/items" element={<Home />} />
        <Route path="/items/:itemId" element={<ItemDetail />} />
        <Route path="/partners/apply" element={<PartnerApply />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route
          path="/mypage"
          element={
            <RequireAuth>
              <MyPage />
            </RequireAuth>
          }
        />
        <Route
          path="/org"
          element={
            <RequireOrg>
              <OrgItems />
            </RequireOrg>
          }
        />
        <Route
          path="/org/revenue"
          element={
            <RequireOrg>
              <OrgRevenue />
            </RequireOrg>
          }
        />
        <Route
          path="/org/contact"
          element={
            <RequireOrg>
              <OrgContact />
            </RequireOrg>
          }
        />
        <Route
          path="/org/items/new"
          element={
            <RequireOrg>
              <OrgItemForm />
            </RequireOrg>
          }
        />
        <Route
          path="/org/items/:itemId/edit"
          element={
            <RequireOrg>
              <OrgItemForm />
            </RequireOrg>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminItems />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/organizations"
          element={
            <RequireAdmin>
              <AdminOrganizations />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/partners"
          element={
            <RequireAdmin>
              <AdminPartnerApplications />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/monitor"
          element={
            <RequireAdmin>
              <BidMonitor />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/dashboard"
          element={
            <RequireAdmin>
              <AdminDashboard />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/cloudformation"
          element={
            <RequireAdmin>
              <AdminCloudFormation />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/inquiries"
          element={
            <RequireAdmin>
              <AdminInquiries />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </main>

    <footer className="site-footer">
      <div className="container">
        <p>
          めぐりモノ — 警察の遺失物を、地域の「欲しい」へつなぐオークション（コンテスト応募用デモ）
        </p>
        <p className="site-footer__note">
          掲載されている物品・入札・金額はすべて架空のデータです。実在の遺失物は取り扱っていません。
        </p>
        <details className="credits">
          <summary>出品イメージ画像クレジット（Wikimedia Commons）</summary>
          <ul className="credits__list">
            {IMAGE_CREDITS.map((c) => (
              <li key={c.url}>
                {c.item}: 「{c.title}」by {c.author}（
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.license}
                </a>
                ）
              </li>
            ))}
          </ul>
        </details>
      </div>
    </footer>
  </>
);
