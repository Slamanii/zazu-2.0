import { localUser, userLocation } from '../types'

class LocalUserStore {

    private users = new Map<number, localUser>()

    async getUser(telegramId: number): Promise<localUser | undefined>  {
        return this.users.get(telegramId)
    }


    async createUser(telegramId: number): Promise<localUser> {
        const user: localUser = { telegramId }
        this.users.set(telegramId, user)
        return user
    }

    async setLocation(telegramId: number, location: userLocation) {
        let user = await this.getUser(telegramId)

        if (!user) {
            user = await this.createUser(telegramId)
        }

        user.location = location
        this.users.set(telegramId, user)
    }

}

export const localUserStore = new LocalUserStore()

