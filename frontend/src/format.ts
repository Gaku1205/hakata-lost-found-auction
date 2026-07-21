const yenFormatter = new Intl.NumberFormat('ja-JP');

export const yen = (amount: number): string => `¥${yenFormatter.format(amount)}`;

export type TimeLeft = {
  label: string;
  urgent: boolean;
  ended: boolean;
};

export const timeLeft = (endTime: string, nowMs: number): TimeLeft => {
  const diff = new Date(endTime).getTime() - nowMs;
  if (Number.isNaN(diff) || diff <= 0) {
    return { label: '終了', urgent: false, ended: true };
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return { label: 'まもなく終了', urgent: true, ended: false };
  if (minutes < 60) return { label: `残り${minutes}分`, urgent: true, ended: false };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `残り${hours}時間`, urgent: hours <= 12, ended: false };
  const days = Math.floor(hours / 24);
  return { label: `残り${days}日`, urgent: false, ended: false };
};

export const relativeTime = (isoTime: string, nowMs: number): string => {
  const diff = nowMs - new Date(isoTime).getTime();
  if (Number.isNaN(diff) || diff < 60_000) return 'たった今';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
};

export const formatFoundMonth = (foundMonth: string): string => {
  const [year, month] = foundMonth.split('-');
  if (year === undefined || month === undefined) return foundMonth;
  const monthNumber = Number.parseInt(month, 10);
  if (Number.isNaN(monthNumber)) return foundMonth;
  return `${year}年${monthNumber}月ごろ`;
};

export const formatDate = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-');
  if (year === undefined || month === undefined || day === undefined) return dateStr;
  const monthNumber = Number.parseInt(month, 10);
  const dayNumber = Number.parseInt(day, 10);
  if (Number.isNaN(monthNumber) || Number.isNaN(dayNumber)) return dateStr;
  return `${year}年${monthNumber}月${dayNumber}日`;
};
