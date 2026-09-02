import { useMemo, useState, type CSSProperties } from 'react';
import { Card, Select, Space, Typography } from 'antd';
import { contributionCalendar, contributionMonthStarts, type ContributionDay } from './contributionData';
import { useI18n } from './i18n';

type Props = { dates: Array<string | undefined> };

export default function ContributionCalendar({ dates }: Props) {
  const t = useI18n(); const currentYear = new Date().getFullYear();
  const years = useMemo(() => [...new Set([currentYear, ...dates.flatMap((value) => { const match = value?.match(/^(\d{4})-/); return match ? [Number(match[1])] : []; })])].sort((a, b) => b - a), [dates, currentYear]);
  const [year, setYear] = useState(currentYear);
  const calendar = contributionCalendar(dates, new Date(), year);
  const weeks = Array.from({ length: calendar.weeks }, (_, index) => calendar.days.slice(index * 7, index * 7 + 7));
  const mobileBreak = Math.ceil(weeks.length / 2);
  const mobilePeriods = [weeks.slice(0, mobileBreak), weeks.slice(mobileBreak)];
  const monthNames = t('cc.months').split(',');

  const period = (periodWeeks: ContributionDay[][], key: string) => {
    const monthStarts = contributionMonthStarts(periodWeeks);
    return <div className="contribution-period" key={key} style={{ '--contribution-weeks': periodWeeks.length } as CSSProperties}>
      <div className="contribution-months" aria-hidden="true"><span /><div>{periodWeeks.map((week, index) => {
        const month = monthStarts[index];
        return <span key={week[0].date}>{month ? monthNames[Number(month.slice(5, 7)) - 1] : ''}</span>;
      })}</div></div>
      <div className="contribution-body">
        <div className="contribution-weekdays" aria-hidden="true"><span /> <span>{t('cc.weekdays').split(',')[0]}</span><span /><span>{t('cc.weekdays').split(',')[1]}</span><span /><span>{t('cc.weekdays').split(',')[2]}</span><span /></div>
        <div className="contribution-grid" role="grid" aria-label={t('cc.aria')}>
          {periodWeeks.flat().map((day) => <span
            className={`contribution-cell level-${day.level}${day.inRange ? '' : ' outside'}`}
            key={day.date}
            role="gridcell"
            aria-label={day.count ? t('cc.dayAria', { date: day.date, count: day.count }) : `${day.date}: ${t('cc.none')}`}
            title={day.count ? t('cc.dayTitle', { date: day.date, count: day.count }) : `${day.date}: ${t('cc.none')}`}
          />)}
        </div>
      </div>
    </div>;
  };

  return <Card className="contribution-card" title={t('cc.title')} extra={<Space wrap><Typography.Text type="secondary">{t('cc.total', { total: calendar.total })}</Typography.Text><Select aria-label="Year" value={year} onChange={setYear} options={years.map((value) => ({ value, label: String(value) }))} /></Space>}>
    <div className="contribution-scroll">
      <div className="contribution-inner">
      <div className="contribution-calendar-desktop">{period(weeks, 'desktop')}</div>
      <div className="contribution-calendar-mobile">{mobilePeriods.map((value, index) => period(value, `mobile-${index}`))}</div>
      <div className="contribution-legend"><Typography.Text type="secondary">{t('cc.less')}</Typography.Text>{[0, 1, 2, 3, 4].map((level) => <span className={`contribution-cell level-${level}`} key={level} />)}<Typography.Text type="secondary">{t('cc.more')}</Typography.Text></div>
      </div>
    </div>
  </Card>;
}
