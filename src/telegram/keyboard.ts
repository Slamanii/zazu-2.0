export const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'Place Order', callback_data: "PLACE_ORDER"}],
            [{ text: 'location', callback_data: "LOCATION"}],
            [{ text: 'Menu', web_app: { url: "https://your-web-app-url.com" } }],
            [{ text: 'My Orders', callback_data: "MY_ORDERs"}],
            [{ text: 'Settings', callback_data: "SETTINGS"}],
            [{ text: 'Help', callback_data: "HELP"}],
            [{ text: 'wallets', callback_data: "WALLETS"}],
        ]
    }
}

export const locationButton = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'Set location', callback_data: 'SET_LOCATION' }]
        ]
    }
}

export const showMenuButton = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'Menu', web_app: { url: "https://your-web-app-url.com" } }]
        ]
    }
}

export const openCategoryButton = {
    reply_markup: {
        inine_keyboard: [
            [{ text: 'Category', callback_data: 'OPEN_CATEGORY'}]
        ]
    }
} 

export const addItemButton = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'Add', callback_data: 'ADD_TO_CART'}]
        ]
    }
}