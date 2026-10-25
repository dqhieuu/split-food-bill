// Vietnamese lunar calendar (âm lịch) conversion, after Hồ Ngọc Đức's astronomical algorithm.
const VIETNAM_TIMEZONE = 7;
const SYNODIC_MONTH = 29.530588853;
const EPOCH_NEW_MOON = 2415021.076998695;
const DEGREE = Math.PI / 180;

export type LunarDate = { day: number; month: number; year: number; leap: boolean };

function julianDay(day: number, month: number, year: number): number {
	const a = Math.floor((14 - month) / 12);
	const y = year + 4800 - a;
	const m = month + 12 * a - 3;
	const jd =
		day +
		Math.floor((153 * m + 2) / 5) +
		365 * y +
		Math.floor(y / 4) -
		Math.floor(y / 100) +
		Math.floor(y / 400) -
		32045;
	return jd < 2299161 ? day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083 : jd;
}

function newMoon(k: number): number {
	const t = k / 1236.85;
	const t2 = t * t;
	const t3 = t2 * t;
	let jd = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3;
	jd += 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * DEGREE);
	const sun = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3;
	const moon = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3;
	const latitude = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3;
	let correction = (0.1734 - 0.000393 * t) * Math.sin(sun * DEGREE) + 0.0021 * Math.sin(2 * DEGREE * sun);
	correction += -0.4068 * Math.sin(moon * DEGREE) + 0.0161 * Math.sin(DEGREE * 2 * moon);
	correction += -0.0004 * Math.sin(DEGREE * 3 * moon);
	correction += 0.0104 * Math.sin(DEGREE * 2 * latitude) - 0.0051 * Math.sin(DEGREE * (sun + moon));
	correction += -0.0074 * Math.sin(DEGREE * (sun - moon)) + 0.0004 * Math.sin(DEGREE * (2 * latitude + sun));
	correction +=
		-0.0004 * Math.sin(DEGREE * (2 * latitude - sun)) - 0.0006 * Math.sin(DEGREE * (2 * latitude + moon));
	correction +=
		0.001 * Math.sin(DEGREE * (2 * latitude - moon)) + 0.0005 * Math.sin(DEGREE * (2 * moon + sun));
	const deltaT =
		t < -11
			? 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3
			: -0.000278 + 0.000265 * t + 0.000262 * t2;
	return jd + correction - deltaT;
}

function sunLongitude(jdn: number): number {
	const t = (jdn - 2451545.0) / 36525;
	const t2 = t * t;
	const anomaly = 357.5291 + 35999.0503 * t - 0.0001559 * t2 - 0.00000048 * t * t2;
	const mean = 280.46645 + 36000.76983 * t + 0.0003032 * t2;
	let delta = (1.9146 - 0.004817 * t - 0.000014 * t2) * Math.sin(DEGREE * anomaly);
	delta +=
		(0.019993 - 0.000101 * t) * Math.sin(DEGREE * 2 * anomaly) + 0.00029 * Math.sin(DEGREE * 3 * anomaly);
	const longitude = (mean + delta) * DEGREE;
	return longitude - Math.PI * 2 * Math.floor(longitude / (Math.PI * 2));
}

const sunSector = (day: number) =>
	Math.floor((sunLongitude(day - 0.5 - VIETNAM_TIMEZONE / 24) / Math.PI) * 6);
const newMoonDay = (k: number) => Math.floor(newMoon(k) + 0.5 + VIETNAM_TIMEZONE / 24);

function lunarMonth11(year: number): number {
	const k = Math.floor((julianDay(31, 12, year) - 2415021) / SYNODIC_MONTH);
	const day = newMoonDay(k);
	return sunSector(day) >= 9 ? newMoonDay(k - 1) : day;
}

function leapMonthOffset(month11: number): number {
	const k = Math.floor((month11 - EPOCH_NEW_MOON) / SYNODIC_MONTH + 0.5);
	let index = 1;
	let arc = sunSector(newMoonDay(k + index));
	let last: number;
	do {
		last = arc;
		index++;
		arc = sunSector(newMoonDay(k + index));
	} while (arc !== last && index < 14);
	return index - 1;
}

export function toLunar(day: number, month: number, year: number): LunarDate {
	const dayNumber = julianDay(day, month, year);
	const k = Math.floor((dayNumber - EPOCH_NEW_MOON) / SYNODIC_MONTH);
	let monthStart = newMoonDay(k + 1);
	if (monthStart > dayNumber) monthStart = newMoonDay(k);
	let a11 = lunarMonth11(year);
	let b11 = a11;
	let lunarYear: number;
	if (a11 >= monthStart) {
		lunarYear = year;
		a11 = lunarMonth11(year - 1);
	} else {
		lunarYear = year + 1;
		b11 = lunarMonth11(year + 1);
	}
	const diff = Math.floor((monthStart - a11) / 29);
	let leap = false;
	let lunarMonth = diff + 11;
	if (b11 - a11 > 365) {
		const leapDiff = leapMonthOffset(a11);
		if (diff >= leapDiff) {
			lunarMonth = diff + 10;
			leap = diff === leapDiff;
		}
	}
	if (lunarMonth > 12) lunarMonth -= 12;
	if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
	return { day: dayNumber - monthStart + 1, month: lunarMonth, year: lunarYear, leap };
}
