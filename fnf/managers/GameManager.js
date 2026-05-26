const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * ═══════════════════════════════════════════════════════════════
 * FNF GAME MANAGER - Handles all active games with safety
 * ═══════════════════════════════════════════════════════════════
 */

class FNFGameManager {
    constructor() {
        this.games = new Map(); // userId -> GameState
        this.collectors = new Map(); // gameId -> MessageCollector
        this.gameTimeout = 5 * 60 * 1000; // 5 min timeout
        this.cleanupInterval = 60 * 1000; // Check every 1 min
        
        console.log('✅ FNF Game Manager initialized');
        this.startCleanupLoop();
    }

    /**
     * Create a new game instance
     */
    createGame(userId, difficulty, songId, opponentId) {
        try {
            const gameId = `fnf_${userId}_${Date.now()}`;
            
            const game = {
                gameId,
                userId,
                difficulty,
                songId,
                opponentId,
                createdAt: Date.now(),
                state: 'playing', // playing, paused, ended, crashed
                score: 0,
                combo: 0,
                maxCombo: 0,
                misses: 0,
                hits: 0,
                totalNotes: 0,
                health: 50,
                maxHealth: 100,
                accuracy: 0,
                notes: [],
                currentNoteIndex: 0,
                messageId: null,
                channelId: null,
                interactionMessage: null
            };

            // Size limit - don't allow more than one game per user
            if (this.games.has(userId)) {
                return null; // Already playing
            }

            this.games.set(userId, game);
            console.log(`🎮 Game created: ${gameId}`);
            return game;
        } catch (e) {
            console.error('❌ Error creating game:', e?.message);
            return null;
        }
    }

    /**
     * Get active game for user
     */
    getGame(userId) {
        return this.games.get(String(userId)) || null;
    }

    /**
     * Update game score safely
     */
    updateGameScore(userId, points) {
        try {
            const game = this.getGame(userId);
            if (!game) return false;

            game.score += points;
            game.hits++;
            return true;
        } catch (e) {
            console.error('❌ Error updating score:', e?.message);
            return false;
        }
    }

    /**
     * Update game combo safely
     */
    updateGameCombo(userId, hit) {
        try {
            const game = this.getGame(userId);
            if (!game) return false;

            if (hit) {
                game.combo++;
                if (game.combo > game.maxCombo) {
                    game.maxCombo = game.combo;
                }
            } else {
                game.misses++;
                game.combo = 0;
            }
            return true;
        } catch (e) {
            console.error('❌ Error updating combo:', e?.message);
            return false;
        }
    }

    /**
     * Update health with boundaries
     */
    updateHealth(userId, amount) {
        try {
            const game = this.getGame(userId);
            if (!game) return false;

            game.health = Math.max(0, Math.min(game.maxHealth, game.health + amount));
            return true;
        } catch (e) {
            console.error('❌ Error updating health:', e?.message);
            return false;
        }
    }

    /**
     * Calculate accuracy percentage
     */
    calculateAccuracy(userId) {
        try {
            const game = this.getGame(userId);
            if (!game || game.totalNotes === 0) return 0;

            return Math.round((game.hits / game.totalNotes) * 100);
        } catch (e) {
            console.error('❌ Error calculating accuracy:', e?.message);
            return 0;
        }
    }

    /**
     * Get game ranking
     */
    getRanking(userId) {
        try {
            const accuracy = this.calculateAccuracy(userId);
            
            if (accuracy >= 95) return 'S+';
            if (accuracy >= 90) return 'S';
            if (accuracy >= 85) return 'A';
            if (accuracy >= 75) return 'B';
            if (accuracy >= 60) return 'C';
            return 'D';
        } catch (e) {
            console.error('❌ Error calculating ranking:', e?.message);
            return 'D';
        }
    }

    /**
     * End game and cleanup
     */
    endGame(userId) {
        try {
            const game = this.getGame(userId);
            if (!game) return null;

            game.state = 'ended';
            game.accuracy = this.calculateAccuracy(userId);
            game.ranking = this.getRanking(userId);

            // Cleanup collector
            const collectorKey = `collector_${userId}`;
            if (this.collectors.has(collectorKey)) {
                const collector = this.collectors.get(collectorKey);
                collector.stop('game_ended');
                this.collectors.delete(collectorKey);
            }

            // Keep game in map for result display, but mark it
            console.log(`✅ Game ended for ${userId}`);
            return game;
        } catch (e) {
            console.error('❌ Error ending game:', e?.message);
            return null;
        }
    }

    /**
     * Get game results
     */
    getGameResults(userId) {
        try {
            const game = this.getGame(userId);
            if (!game || game.state !== 'ended') return null;

            return {
                score: game.score,
                combo: game.maxCombo,
                misses: game.misses,
                accuracy: game.accuracy,
                ranking: game.ranking,
                health: game.health,
                difficulty: game.difficulty,
                songId: game.songId
            };
        } catch (e) {
            console.error('❌ Error getting results:', e?.message);
            return null;
        }
    }

    /**
     * Clean up old/broken games
     */
    cleanupGames() {
        try {
            const now = Date.now();
            let cleaned = 0;

            for (const [userId, game] of this.games.entries()) {
                const age = now - game.createdAt;

                // Remove games older than timeout
                if (age > this.gameTimeout) {
                    this.games.delete(userId);
                    cleaned++;
                    console.log(`🧹 Cleaned up old game: ${userId}`);
                }

                // Remove crashed games
                if (game.state === 'crashed') {
                    this.games.delete(userId);
                    cleaned++;
                    console.log(`🧹 Cleaned up crashed game: ${userId}`);
                }
            }

            if (cleaned > 0) {
                console.log(`✅ Cleanup: Removed ${cleaned} games`);
            }

            return cleaned;
        } catch (e) {
            console.error('❌ Cleanup error:', e?.message);
            return 0;
        }
    }

    /**
     * Clean up collectors
     */
    cleanupCollectors() {
        try {
            let cleaned = 0;
            
            for (const [key, collector] of this.collectors.entries()) {
                // If collector is not active, remove it
                if (!collector.active) {
                    this.collectors.delete(key);
                    cleaned++;
                }
            }

            if (cleaned > 0) {
                console.log(`✅ Collector cleanup: Removed ${cleaned}`);
            }

            return cleaned;
        } catch (e) {
            console.error('❌ Collector cleanup error:', e?.message);
            return 0;
        }
    }

    /**
     * Auto cleanup loop
     */
    startCleanupLoop() {
        setInterval(() => {
            try {
                this.cleanupGames();
                this.cleanupCollectors();
            } catch (e) {
                console.error('❌ Cleanup loop error:', e?.message);
            }
        }, this.cleanupInterval);
    }

    /**
     * Store collector reference for cleanup
     */
    registerCollector(userId, collector) {
        try {
            const key = `collector_${userId}`;
            this.collectors.set(key, collector);
            
            // Auto-cleanup when collector ends
            collector.once('end', () => {
                this.collectors.delete(key);
            });
        } catch (e) {
            console.error('❌ Error registering collector:', e?.message);
        }
    }

    /**
     * Get stats summary
     */
    getStats() {
        return {
            activeGames: this.games.size,
            activeCollectors: this.collectors.size,
            gamesTotal: [...this.games.values()].length
        };
    }
}

module.exports = FNFGameManager;
