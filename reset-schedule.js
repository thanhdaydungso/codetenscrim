'use strict';

// Vietnam is UTC+7; 04:00 local time is 21:00 UTC the previous day.
function nextVietnamReset(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(21, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

module.exports = { nextVietnamReset };
