import { Card, Typography } from 'antd';
import { contributionCalendar } from './contributionData';

type Props = { dates: Array<string | undefined> };

export default function ContributionCalendar({ dates }: Props) {
  const calendar = contributionCalendar(dates);
  const weeks = Array.from({ length: calendar.weeks }, (_, index) => calendar.days.slice(index * 7, index * 7 + 7));

  return <Card className="contribution-card" title="近一年创作贡献" extra={<Typography.Text type="secondary">共创作 {calendar.total} 篇</Typography.Text>}>
    <div className="contribution-scroll">
      <div className="contribution-months" aria-hidden="true"><span /><div>{weeks.map((week) => {
        const first = week.find((day) => Number(day.date.slice(8, 10)) <= 7 && day.inRange);
        return <span key={week[0].date}>{first ? `${Number(first.date.slice(5, 7))}月` : ''}</span>;
      })}</div></div>
      <div className="contribution-body">
        <div className="contribution-weekdays" aria-hidden="true"><span /> <span>一</span><span /><span>三</span><span /><span>五</span><span /></div>
        <div className="contribution-grid" role="grid" aria-label="近一年每日创作数量">
          {calendar.days.map((day) => <span
            className={`contribution-cell level-${day.level}${day.inRange ? '' : ' outside'}`}
            key={day.date}
            role="gridcell"
            aria-label={`${day.date}，${day.count ? `创作 ${day.count} 篇` : '无创作'}`}
            title={`${day.date}：${day.count ? `${day.count} 篇创作` : '无创作'}`}
          />)}
        </div>
      </div>
      <div className="contribution-legend"><Typography.Text type="secondary">少</Typography.Text>{[0, 1, 2, 3, 4].map((level) => <span className={`contribution-cell level-${level}`} key={level} />)}<Typography.Text type="secondary">多</Typography.Text></div>
    </div>
  </Card>;
}
