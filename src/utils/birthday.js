'use strict';

const { EmbedBuilder } = require('discord.js');
const path = require('node:path');
const { ACCENT } = require('./theme');

const BIRTHDAY_IMAGE_NAME = 'birthday.png';
const BIRTHDAY_IMAGE_PATH = path.join(__dirname, '..', '..', 'img', BIRTHDAY_IMAGE_NAME);
const DEFAULT_TIMEZONE = process.env.BIRTHDAY_DEFAULT_TIMEZONE || 'UTC';
const ANNOUNCE_AFTER_MINUTE = Number(process.env.BIRTHDAY_ANNOUNCE_MINUTE_OF_DAY || 5); // 00:05 local

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function daysInMonth(month, year) {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidDate(month, day, year = null) {
    if (!Number.isInteger(month) || month < 1 || month > 12) return false;
    if (!Number.isInteger(day) || day < 1) return false;
    // Without a year, accept Feb 29; with one, the year decides.
    return day <= daysInMonth(month, year ?? 2000);
}

function isValidTimeZone(timeZone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    } catch {
        return false;
    }
}

// Local calendar parts for an instant in a given zone, without a date library.
function zonedParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = Object.fromEntries(
        fmt.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
    );
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
    };
}

function dateKey(parts) {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

// Feb 29 births are celebrated on Mar 1 in non-leap years.
function matchesToday(birthday, todayParts) {
    const { month, day } = birthday;
    if (month === todayParts.month && day === todayParts.day) return true;
    const leapYearBirthday = month === 2 && day === 29;
    const nonLeapToday = todayParts.month === 3 && todayParts.day === 1 && !isLeapYear(todayParts.year);
    return leapYearBirthday && nonLeapToday;
}

function formatBirthday({ month, day, year }) {
    const base = `${String(day).padStart(2, '0')}. ${MONTHS[month - 1]}`;
    return year ? `${base} ${year}` : base;
}

// Grouped by month, chronological, for /birthday list.
function groupByMonth(entries) {
    const sorted = [...entries].sort((a, b) => a.month - b.month || a.day - b.day);
    const groups = new Map();
    for (const entry of sorted) {
        if (!groups.has(entry.month)) groups.set(entry.month, []);
        groups.get(entry.month).push(entry);
    }
    return [...groups.entries()].map(([month, items]) => ({
        month,
        label: MONTHS[month - 1],
        items,
        text: items.map(i => `<@${i.user_id}> — ${formatBirthday({ month: i.month, day: i.day, year: i.year })}`).join('\n'),
    }));
}

function announcementMessage(userId) {
    const embed = new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle('🎂 Happy Birthday!')
        .setDescription(`Today is a special day!\n🎁 Please wish <@${userId}> a happy birthday!`)
        .setThumbnail(`attachment://${BIRTHDAY_IMAGE_NAME}`)
        .setFooter({ text: `MechaBoosya • ${new Date().toISOString().slice(0, 10)}` });

    return {
        embeds: [embed],
        files: [{ attachment: BIRTHDAY_IMAGE_PATH, name: BIRTHDAY_IMAGE_NAME }],
    };
}

// Server-wide list: hint line, month-grouped entries, the same art as the announcement.
function birthdayListMessage(guildName, entries) {
    const body = groupByMonth(entries)
        .map(group => `**${group.label}**\n${group.text}`)
        .join('\n\n');
    const description = `➤ Register your Birthday with \`/birthday register <day> <month> [year]\`\n\n${body}`;

    const embed = new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(`Birthday List - ${guildName}`)
        .setDescription(description.length > 4096 ? `${description.slice(0, 4095)}…` : description)
        .setThumbnail(`attachment://${BIRTHDAY_IMAGE_NAME}`)
        .setFooter({ text: `${entries.length} birthday(s) registered` });

    return {
        embeds: [embed],
        files: [{ attachment: BIRTHDAY_IMAGE_PATH, name: BIRTHDAY_IMAGE_NAME }],
    };
}

module.exports = {
    ACCENT,
    DEFAULT_TIMEZONE,
    ANNOUNCE_AFTER_MINUTE,
    MONTHS,
    daysInMonth,
    isLeapYear,
    isValidDate,
    isValidTimeZone,
    zonedParts,
    dateKey,
    matchesToday,
    formatBirthday,
    groupByMonth,
    announcementMessage,
    birthdayListMessage,
};
