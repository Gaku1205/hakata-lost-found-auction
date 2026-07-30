import { useEffect, useState } from 'react';
import { adminFetchCloudFormation } from '../../api';

type CloudFormationInfo = Awaited<ReturnType<typeof adminFetchCloudFormation>>;

export const AdminCloudFormation = (): JSX.Element => {
  const [data, setData] = useState<CloudFormationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        setLoading(true);
        const result = await adminFetchCloudFormation();
        setData(result);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'エラーが発生しました';
        setError(message);
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return (
      <div className="admin-content">
        <h2>インフラ</h2>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="admin-content">
        <h2>インフラ</h2>
        <div className="notice notice--error" role="alert">
          <p>{error ?? 'データを取得できません'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-content">
      <h2>インフラ（CloudFormation）</h2>

      <section className="admin-section">
        <h3>スタック情報</h3>
        <table className="admin-table">
          <tbody>
            <tr>
              <th>スタック名</th>
              <td>{data.stack.name}</td>
            </tr>
            <tr>
              <th>ステータス</th>
              <td>
                <span className="badge" title={data.stack.status}>
                  {data.stack.status}
                </span>
              </td>
            </tr>
            <tr>
              <th>作成日</th>
              <td>{new Date(data.stack.creationTime).toLocaleString('ja-JP')}</td>
            </tr>
            {data.stack.lastUpdatedTime && (
              <tr>
                <th>最終更新</th>
                <td>{new Date(data.stack.lastUpdatedTime).toLocaleString('ja-JP')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h3>リソース一覧（{data.resources.length}）</h3>
        <div className="table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>論理ID</th>
                <th>物理ID</th>
                <th>タイプ</th>
                <th>ステータス</th>
                <th>タイムスタンプ</th>
              </tr>
            </thead>
            <tbody>
              {data.resources.map((resource, idx) => (
                <tr key={idx}>
                  <td className="mono-text">{resource.logicalId}</td>
                  <td className="mono-text" title={resource.physicalId}>
                    {resource.physicalId?.substring(0, 40)}
                  </td>
                  <td className="mono-text">{resource.type}</td>
                  <td>
                    <span className="badge">{resource.status}</span>
                  </td>
                  <td className="mono-text">
                    {resource.timestamp ? new Date(resource.timestamp).toLocaleString('ja-JP') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <h3>デプロイイベント（最新10件）</h3>
        <div className="table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>タイムスタンプ</th>
                <th>リソース</th>
                <th>ステータス</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event, idx) => (
                <tr key={idx}>
                  <td className="mono-text">
                    {event.timestamp ? new Date(event.timestamp).toLocaleString('ja-JP') : '—'}
                  </td>
                  <td className="mono-text">{event.logicalId}</td>
                  <td>
                    <span className="badge">{event.status}</span>
                  </td>
                  <td>{event.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
