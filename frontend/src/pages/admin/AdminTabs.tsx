import { NavLink } from 'react-router-dom';

export const AdminTabs = (): JSX.Element => (
  <nav className="admin-tabs" aria-label="管理メニュー">
    <NavLink to="/admin" end className="admin-tabs__tab">
      出品管理
    </NavLink>
    <NavLink to="/admin/organizations" className="admin-tabs__tab">
      出品元管理
    </NavLink>
    <NavLink to="/admin/partners" className="admin-tabs__tab">
      出品元申し込み
    </NavLink>
    <NavLink to="/admin/monitor" className="admin-tabs__tab">
      入札監視
    </NavLink>
    <NavLink to="/admin/dashboard" className="admin-tabs__tab">
      収益ダッシュボード
    </NavLink>
  </nav>
);
