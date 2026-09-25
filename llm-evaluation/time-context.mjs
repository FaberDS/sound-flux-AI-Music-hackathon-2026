export function localTimeContext(date = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('de-AT', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return {
    currentDate: `${parts.year}-${parts.month}-${parts.day}`,
    currentTime: `${parts.hour}:${parts.minute}`,
    timeZone,
    currentYear: Number(parts.year),
  };
}

export function daytimeGreeting({ currentTime } = localTimeContext()) {
  const hour = Number(currentTime.slice(0, 2));
  if (hour >= 5 && hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Guten Tag';
  if (hour < 22) return 'Guten Abend';
  return 'Hallo';
}
