import { NavLink } from 'react-router-dom';

export const AdminTabs = (): JSX.Element => (
  <nav className="admin-tabs" aria-label="管理メニュー">
    <NavLink to="/admin" end className="admin-tabs__tab">
      出品管理
    </NavLink>
    <NavLink to="/admin/monitor" className="admin-tabs__tab">
      入札監視
    </NavLink>
  </nav>
);
