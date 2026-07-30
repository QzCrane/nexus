// goal: Lorem Ipsum core logic - generate placeholder text

import type { LoremConfig } from './types';

// Classic Lorem Ipsum word bank
const WORDS = [
	'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
	'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
	'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
	'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
	'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
	'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
	'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
	'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum', 'praesentium', 'voluptatum',
	'deleniti', 'atque', 'corrupti', 'quos', 'dolores', 'quas', 'molestias',
	'excepturi', 'occaecati', 'cupiditate', 'provident', 'similique', 'mollitia',
	'animi', 'eos', 'blanditiis', 'ducimus', 'perferendis', 'odio', 'fuga',
	'dignissimos', 'rerum', 'facilis', 'expedita', 'distinctio', 'nam', 'libero',
	'tempore', 'cum', 'soluta', 'nobis', 'eligendi', 'optio', 'cumque', 'nihil',
];

// Get random word
function randomWord(): string {
	return WORDS[Math.floor(Math.random() * WORDS.length)] ?? 'lorem';
}

// Generate words
export function generateWords(count: number, startWithLorem: boolean): string {
	const words: string[] = [];
	if (startWithLorem) {
		words.push('Lorem', 'ipsum');
		count = Math.max(0, count - 2);
	}
	for (let i = 0; i < count; i++) {
		words.push(randomWord());
	}
	return words.join(' ');
}

// Generate sentence (8-15 words)
function generateSentence(startWithLorem: boolean): string {
	const wordCount = 8 + Math.floor(Math.random() * 8);
	let sentence = generateWords(wordCount, startWithLorem);
	sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
	return `${sentence}.`;
}

// Generate sentences
export function generateSentences(count: number, startWithLorem: boolean): string {
	const sentences: string[] = [];
	for (let i = 0; i < count; i++) {
		sentences.push(generateSentence(i === 0 && startWithLorem));
	}
	return sentences.join(' ');
}

// Generate paragraph (4-7 sentences)
function generateParagraph(startWithLorem: boolean): string {
	const sentenceCount = 4 + Math.floor(Math.random() * 4);
	return generateSentences(sentenceCount, startWithLorem);
}

// Generate paragraphs
export function generateParagraphs(count: number, startWithLorem: boolean): string {
	const paragraphs: string[] = [];
	for (let i = 0; i < count; i++) {
		paragraphs.push(generateParagraph(i === 0 && startWithLorem));
	}
	return paragraphs.join('\n\n');
}

// Main generator function
export function generateLorem(config: LoremConfig): string {
	const { unit, count, startWithLorem } = config;
	switch (unit) {
		case 'words':
			return generateWords(count, startWithLorem);
		case 'sentences':
			return generateSentences(count, startWithLorem);
		case 'paragraphs':
			return generateParagraphs(count, startWithLorem);
		default:
			return '';
	}
}
