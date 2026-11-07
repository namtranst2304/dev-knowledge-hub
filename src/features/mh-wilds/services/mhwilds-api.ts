import type { Monster, Weapon, Armor, Skill, Item, Decoration, Charm, Location, Ailment, ArmorSet, MotionValue } from '../types';

const BASE_URL = '/data/mhwilds';

// In-memory Promise cache to avoid duplicate network downloads and JSON parse overhead
const jsonCache = new Map<string, Promise<unknown>>();

async function fetchLocal<T>(filename: string): Promise<T> {
    if (jsonCache.has(filename)) {
        return jsonCache.get(filename) as Promise<T>;
    }

    const fetchPromise = (async () => {
        const url = `${BASE_URL}/${filename}`;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) {
                throw new Error(`Failed to load static data: ${res.status} ${res.statusText}`);
            }
            return (await res.json()) as T;
        } catch (err) {
            jsonCache.delete(filename); // Clean up failed request from cache
            throw err;
        }
    })();

    jsonCache.set(filename, fetchPromise);
    return fetchPromise;
}

// === Monsters ===
export async function getMonsters(): Promise<Monster[]> {
    return fetchLocal<Monster[]>('monsters.json');
}

export async function getMonster(id: number): Promise<Monster> {
    return fetchLocal<Monster[]>('monsters.json').then(res => res.find(m => m.id === id)!);
}

// === Weapons ===
export async function getWeapons(): Promise<Weapon[]> {
    return fetchLocal<Weapon[]>('weapons.json');
}

export async function getWeapon(id: number): Promise<Weapon> {
    return fetchLocal<Weapon[]>('weapons.json').then(res => res.find(w => w.id === id)!);
}

// === Armor ===
export async function getArmor(): Promise<Armor[]> {
    return fetchLocal<Armor[]>('armor.json');
}

export async function getArmorPiece(id: number): Promise<Armor> {
    return fetchLocal<Armor[]>('armor.json').then(res => res.find(a => a.id === id)!);
}

// === Armor Sets ===
export async function getArmorSets(): Promise<ArmorSet[]> {
    return fetchLocal<ArmorSet[]>('armor-sets.json');
}

// === Skills ===
export async function getSkills(): Promise<Skill[]> {
    return fetchLocal<Skill[]>('skills.json');
}

// === Items ===
export async function getItems(): Promise<Item[]> {
    return fetchLocal<Item[]>('items.json');
}

// === Decorations ===
export async function getDecorations(): Promise<Decoration[]> {
    return fetchLocal<Decoration[]>('decorations.json');
}

// === Charms ===
export async function getCharms(): Promise<Charm[]> {
    return fetchLocal<Charm[]>('charms.json');
}

// === Locations ===
export async function getLocations(): Promise<Location[]> {
    return fetchLocal<Location[]>('locations.json');
}

// === Ailments ===
export async function getAilments(): Promise<Ailment[]> {
    return fetchLocal<Ailment[]>('ailments.json');
}

// === Motion Values ===
export async function getMotionValues(): Promise<MotionValue[]> {
    return fetchLocal<MotionValue[]>('motion-values.json');
}
