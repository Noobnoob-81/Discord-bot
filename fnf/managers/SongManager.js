const fs = require('fs');
const path = require('path');

/**
 * ═══════════════════════════════════════════════════════════════
 * FNF SONG MANAGER - Loads and manages songs with caching
 * ═══════════════════════════════════════════════════════════════
 */

class FNFSongManager {
    constructor() {
        this.songs = new Map(); // songId -> SongData
        this.cache = new Map(); // Cache for parsed songs
        this.songsPath = path.join(__dirname, '../data/songs.json');
        
        console.log('✅ FNF Song Manager initialized');
        this.loadSongs();
    }

    /**
     * Load songs from JSON file
     */
    loadSongs() {
        try {
            if (!fs.existsSync(this.songsPath)) {
                console.warn('⚠️ Songs file not found, using defaults');
                this.createDefaultSongs();
                return;
            }

            const data = JSON.parse(fs.readFileSync(this.songsPath, 'utf8'));
            
            if (!Array.isArray(data.songs)) {
                throw new Error('Invalid songs format');
            }

            for (const song of data.songs) {
                if (this.validateSong(song)) {
                    this.songs.set(song.id, song);
                }
            }

            console.log(`✅ Loaded ${this.songs.size} songs`);
        } catch (e) {
            console.error('❌ Error loading songs:', e?.message);
            this.createDefaultSongs();
        }
    }

    /**
     * Validate song structure
     */
    validateSong(song) {
        try {
            if (!song.id || !song.name || !song.difficulties) {
                return false;
            }

            // Check if has all difficulties
            const required = ['easy', 'medium', 'hard', 'erect', 'nightmare'];
            for (const diff of required) {
                if (!song.difficulties[diff]) {
                    return false;
                }
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Create default songs if none exist
     */
    createDefaultSongs() {
        try {
            const defaultSongs = {
                songs: [
                    {
                        id: 'tutorial',
                        name: 'Tutorial',
                        artist: 'Boyfriend',
                        bpm: 120,
                        duration: 30,
                        difficulties: {
                            easy: {
                                notes: 'L U R D L U R D L U R D L U R D',
                                noteSpeed: 1,
                                noteCount: 16,
                                reactionTime: 200,
                                healthDrain: 0.02,
                                scoreMultiplier: 1
                            },
                            medium: {
                                notes: 'L U R D L U R D L U R D L U R D L U R D L U R D',
                                noteSpeed: 1.3,
                                noteCount: 24,
                                reactionTime: 150,
                                healthDrain: 0.04,
                                scoreMultiplier: 1.5
                            },
                            hard: {
                                notes: 'L U R D L U R D L U R D L U R D L U R D L U R D L U R D L U R D',
                                noteSpeed: 1.6,
                                noteCount: 32,
                                reactionTime: 100,
                                healthDrain: 0.06,
                                scoreMultiplier: 2
                            },
                            erect: {
                                notes: 'L U R D U R D L R D L U D L U R L U R D L U R D L U R D L U R D',
                                noteSpeed: 2,
                                noteCount: 40,
                                reactionTime: 75,
                                healthDrain: 0.08,
                                scoreMultiplier: 3
                            },
                            nightmare: {
                                notes: 'L U R D U R D L R D L U D L U R L U R D L U R D L U R D L U R D U R D L R D L U',
                                noteSpeed: 2.5,
                                noteCount: 48,
                                reactionTime: 50,
                                healthDrain: 0.12,
                                scoreMultiplier: 5
                            }
                        }
                    }
                ]
            };

            // Ensure directory exists
            const dir = path.dirname(this.songsPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(this.songsPath, JSON.stringify(defaultSongs, null, 2));
            
            this.songs.set('tutorial', defaultSongs.songs[0]);
            console.log('✅ Created default songs');
        } catch (e) {
            console.error('❌ Error creating default songs:', e?.message);
        }
    }

    /**
     * Get song by ID with validation
     */
    getSong(songId) {
        try {
            const song = this.songs.get(String(songId));
            if (!song) {
                return null;
            }
            return song;
        } catch (e) {
            console.error('❌ Error getting song:', e?.message);
            return null;
        }
    }

    /**
     * Get all available songs
     */
    getAllSongs() {
        try {
            return Array.from(this.songs.values());
        } catch (e) {
            console.error('❌ Error getting all songs:', e?.message);
            return [];
        }
    }

    /**
     * Get difficulty config with validation
     */
    getDifficultyConfig(songId, difficulty) {
        try {
            const song = this.getSong(songId);
            if (!song) return null;

            const config = song.difficulties[String(difficulty)];
            if (!config) return null;

            return {
                notes: config.notes ? config.notes.split(' ') : [],
                noteSpeed: Math.max(0.5, config.noteSpeed || 1),
                noteCount: Math.max(1, config.noteCount || 10),
                reactionTime: Math.max(20, config.reactionTime || 100),
                healthDrain: Math.max(0, Math.min(0.5, config.healthDrain || 0.05)),
                scoreMultiplier: Math.max(1, config.scoreMultiplier || 1)
            };
        } catch (e) {
            console.error('❌ Error getting difficulty config:', e?.message);
            return null;
        }
    }

    /**
     * Generate note sequence
     */
    generateNoteSequence(songId, difficulty) {
        try {
            const config = this.getDifficultyConfig(songId, difficulty);
            if (!config) return [];

            const notes = [];
            const noteMap = { 'L': '⬅️', 'U': '⬆️', 'R': '➡️', 'D': '⬇️' };
            const availableNotes = Object.keys(noteMap);

            // Use predefined notes if available
            if (config.notes && config.notes.length > 0) {
                for (let i = 0; i < config.noteCount; i++) {
                    const noteKey = config.notes[i % config.notes.length];
                    notes.push(noteMap[noteKey] || '⬅️');
                }
            } else {
                // Generate random sequence
                for (let i = 0; i < config.noteCount; i++) {
                    const randomNote = availableNotes[Math.floor(Math.random() * availableNotes.length)];
                    notes.push(noteMap[randomNote]);
                }
            }

            return notes;
        } catch (e) {
            console.error('❌ Error generating note sequence:', e?.message);
            return [];
        }
    }

    /**
     * Get difficulty display color
     */
    getDifficultyColor(difficulty) {
        const colors = {
            easy: 0x00ff00,      // Green
            medium: 0xffff00,    // Yellow
            hard: 0xff6600,      // Orange
            erect: 0xff0000,     // Red
            nightmare: 0x660033  // Dark Purple
        };
        return colors[String(difficulty)] || 0x7289DA;
    }

    /**
     * Get difficulty display emoji
     */
    getDifficultyEmoji(difficulty) {
        const emojis = {
            easy: '🟩',
            medium: '🟨',
            hard: '🟧',
            erect: '🔴',
            nightmare: '💜'
        };
        return emojis[String(difficulty)] || '❓';
    }

    /**
     * Clear cache to free memory
     */
    clearCache() {
        try {
            this.cache.clear();
            console.log('✅ Song cache cleared');
        } catch (e) {
            console.error('❌ Error clearing cache:', e?.message);
        }
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            totalSongs: this.songs.size,
            cacheSize: this.cache.size
        };
    }
}

module.exports = FNFSongManager;
