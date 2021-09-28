export const prettyTime = (seconds: number): string => {
  const nSeconds = seconds % 60;
  let nMinutes = Math.floor(seconds / 60);
  const nHours = Math.floor(nMinutes / 60);

  let res = '';

  if (nHours !== 0) {
    res += `${Math.round(nHours).toString().padStart(2, '0')}:`;
    nMinutes -= nHours * 60;
  }

  res += `${Math.round(nMinutes).toString().padStart(2, '0')}:${Math.round(nSeconds).toString().padStart(2, '0')}`;

  return res;
};

export const parseTime = (str: string): number => str.split(':').reduce((acc, time) => (60 * acc) + parseInt(time, 10), 0);
