'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('node:path');
const { ACCENT } = require('./theme');

const BIRTHDAY_IMAGE_NAME = 'birthday.png';
const BIRTHDAY_IMAGE_PATH = path.join(__dirname, '..', '..', 'img', BIRTHDAY_IMAGE_NAME);
const DEFAULT_TIMEZONE = process.env.BIRTHDAY_DEFAULT_TIMEZONE || 'UTC';
const ANNOUNCE_AFTER_MINUTE = Number(process.env.BIRTHDAY_ANNOUNCE_MINUTE_OF_DAY || 5); // 00:05 local
const PAGE_BUDGET = Number(process.env.BIRTHDAY_PAGE_CHARS || 3600);
const MAX_PAGE_BUTTONS = 25;

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

function isLastDayOfMonth(parts) {
    return parts.day === daysInMonth(parts.month, parts.year);
}

function nextMonth(month) {
    return month === 12 ? 1 : month + 1;
}

// What to do with the pinned monthly message: refresh it, move it, or post a new one.
function monthlyAction(existing, { channelId, targetMonth }) {
    if (!existing) return 'post';
    if (existing.channel_id !== channelId) return 'move';
    if (existing.month !== targetMonth) return 'rollover';
    return 'refresh';
}

// Pinned "upcoming birthdays" post: everyone registered in that month, nothing else.
function monthlyMessage(month, entries) {
    const inMonth = entries.filter(entry => entry.month === month);
    const body = inMonth.length > 0
        ? groupByMonth(inMonth)[0].text
        : `No birthdays registered for ${MONTHS[month - 1]} yet.`;
    const hint = '➤ Register your Birthday with\n`/birthday register <day> <month> [year]`';

    const embed = new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(`Upcoming birthdays of ${MONTHS[month - 1]}`)
        .setDescription(`${hint}\n\n${body}`)
        .setThumbnail(`attachment://${BIRTHDAY_IMAGE_NAME}`)
        .setFooter({ text: `${inMonth.length} birthday(s) in ${MONTHS[month - 1]}` });

    return {
        embeds: [embed],
        files: [{ attachment: BIRTHDAY_IMAGE_PATH, name: BIRTHDAY_IMAGE_NAME }],
    };
}

// Pages are filled to the description budget instead of a fixed entry count, so a long
// list needs as few pages as the 4096-char embed allows. Header cost repeats per page.
function buildListPages(entries, { maxChars = PAGE_BUDGET } = {}) {
    const sorted = [...entries].sort((a, b) => a.month - b.month || a.day - b.day);
    if (sorted.length === 0) return [{ items: [], groups: [] }];

    const lineCost = entry => `<@${entry.user_id}> — ${formatBirthday(entry)}`.length + 1;
    const headerCost = (month, used) => `**${MONTHS[month - 1]}**\n`.length + (used > 0 ? 2 : 0);

    const pages = [];
    let items = [];
    let used = 0;
    let lastMonth = null;

    for (const entry of sorted) {
        const monthChanged = entry.month !== lastMonth;
        const cost = lineCost(entry) + (monthChanged ? headerCost(entry.month, used) : 0);

        if (items.length > 0 && used + cost > maxChars) {
            pages.push(items);
            items = [];
            used = lineCost(entry) + headerCost(entry.month, 0);
        } else {
            used += cost;
        }

        items.push(entry);
        lastMonth = entry.month;
    }

    if (items.length > 0) pages.push(items);
    return pages.map(pageItems => ({ items: pageItems, groups: groupByMonth(pageItems) }));
}

// One button per page, active page shown as a disabled primary button (Birthdayy's pattern).
function pageButtons(page, pageCount) {
    if (pageCount <= 1) return [];

    let first = 0;
    let count = pageCount;
    if (pageCount > MAX_PAGE_BUTTONS) {
        count = 5;
        first = Math.min(Math.max(page - 2, 0), pageCount - count);
    }

    const buttons = [];
    for (let i = first; i < first + count; i++) {
        buttons.push(new ButtonBuilder()
            .setCustomId(`blist:${i}`)
            .setLabel(String(i + 1))
            .setStyle(i === page ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(i === page));
    }

    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    return rows;
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

// Server-wide list: hint line, one page of month-grouped entries, the announcement art.
function birthdayListMessage(guildName, entries, { page = 0 } = {}) {
    const pages = buildListPages(entries);
    const current = Math.min(Math.max(page, 0), pages.length - 1);
    const hint = '➤ Register your Birthday with\n`/birthday register <day> <month> [year]`';
    const body = pages[current].groups
        .map(group => `**${group.label}**\n${group.text}`)
        .join('\n\n');
    const description = `${hint}\n\n${body}`;

    const embed = new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(`Birthday List - ${guildName}`)
        .setDescription(description.length > 4096 ? `${description.slice(0, 4095)}…` : description)
        .setThumbnail(`attachment://${BIRTHDAY_IMAGE_NAME}`)
        .setFooter({ text: `${entries.length} birthday(s) registered · Page ${current + 1}/${pages.length}` });

    return {
        embeds: [embed],
        files: [{ attachment: BIRTHDAY_IMAGE_PATH, name: BIRTHDAY_IMAGE_NAME }],
        components: pageButtons(current, pages.length),
        page: current,
        pageCount: pages.length,
    };
}

module.exports = {
    ACCENT,
    DEFAULT_TIMEZONE,
    ANNOUNCE_AFTER_MINUTE,
    PAGE_BUDGET,
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
    buildListPages,
    pageButtons,
    isLastDayOfMonth,
    nextMonth,
    monthlyAction,
    monthlyMessage,
    announcementMessage,
    birthdayListMessage,
};
