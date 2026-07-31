import { NavLink } from 'react-router-dom';

export const OrgTabs = (): JSX.Element => (
  <nav className="admin-tabs" aria-label="出品元メニュー">
    <NavLink to="/org" end className="admin-tabs__tab">
      出品一覧
    </NavLink>
    <NavLink to="/org/revenue" className="admin-tabs__tab">
      収益情報
    </NavLink>
    <NavLink to="/org/contact" className="admin-tabs__tab">
      運営への問い合わせ
    </NavLink>
  </nav>
);
