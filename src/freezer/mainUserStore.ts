import { MainUser, userLocation } from '../types'
import crypto from 'crypto'


class MainUserStore {
    private users = new Map<string, MainUser>()

    async createUser(telegramId: number): Promise<MainUser> {
        const id = crypto.randomUUID()

        const user: MainUser = {
            id,
            telegramId
        }  

        this.users.set(id, user)
        return user
    }

    async findByTelegramId(telegramId: number) {
        for (const user of this.users.values()) {
            if (user.telegramId === telegramId) return user
        }
    }

    async updateLocation(userId: string, location: userLocation) {
        const user = await this.users.get(userId)

        if (!user) return 
        user.location = location
        this.users.set(userId, user)
        
    }
}

export const mainUserStore = new MainUserStore()