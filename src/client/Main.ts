import { GameRunner, joinLobby } from "./GameRunner";
import backgroundImage from '../../resources/images/TerrainMapFrontPage.png';
import favicon from '../../resources/images/Favicon.svg';

import './PublicLobby';
import './UsernameInput';
import './styles.css';
import { UsernameInput } from "./UsernameInput";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { HostLobbyModal as HostPrivateLobbyModal } from "./HostLobbyModal";
import { JoinPrivateLobbyModal } from "./JoinPrivateLobbyModal";




class Client {
    private gameStop: () => void

    private ip: Promise<string | null> = null

    private usernameInput: UsernameInput | null = null;

    private joinModal: JoinPrivateLobbyModal
    constructor() {
    }

    initialize(): void {
        this.usernameInput = document.querySelector('username-input') as UsernameInput;
        if (!this.usernameInput) {
            console.warn('Username input element not found');
        }
        const s = this.stopGame
        window.addEventListener('beforeunload', function (event) {
            console.log('Browser is closing');
            if (s != null) {
                s()
            }
        });

        setFavicon()
        this.ip = getClientIP()
        document.addEventListener('join-lobby', this.handleJoinLobby.bind(this));
        document.addEventListener('leave-lobby', this.handleLeaveLobby.bind(this));
        document.addEventListener('single-player', this.handleSinglePlayer.bind(this));


        const spModal = document.querySelector('single-player-modal') as SinglePlayerModal;
        spModal instanceof SinglePlayerModal
        document.getElementById('single-player').addEventListener('click', () => {
            spModal.open();
        })

        const hostModal = document.querySelector('host-lobby-modal') as HostPrivateLobbyModal;
        hostModal instanceof HostPrivateLobbyModal
        document.getElementById('host-lobby-button').addEventListener('click', () => {
            hostModal.open();
        })

        this.joinModal = document.querySelector('join-private-lobby-modal') as JoinPrivateLobbyModal;
        this.joinModal instanceof JoinPrivateLobbyModal
        document.getElementById('join-private-lobby-button').addEventListener('click', () => {
            this.joinModal.open();
        })
    }

    private async handleJoinLobby(event: CustomEvent) {
        const lobby = event.detail.lobby
        console.log(`joining lobby ${lobby.id}`)
        const clientIP = await this.ip
        console.log(`got ip ${clientIP}`)
        if (this.gameStop != null) {
            console.log('joining lobby, stopping existing game')
            this.gameStop()
        }
        this.gameStop = joinLobby(
            {
                isLocal: event.detail.singlePlayer,
                playerName: (): string => this.usernameInput.getCurrentUsername(),
                gameID: lobby.id,
                ip: clientIP,
                map: event.detail.map,
                difficulty: event.detail.difficulty,
            },
            () => this.joinModal.close()
        );
    }

    private stopGame() {
        this?.gameStop?.()
    }

    private async handleLeaveLobby(event: CustomEvent) {
        if (this.gameStop == null) {
            return
        }
        console.log('leaving lobby, cancelling game')
        this.gameStop()
        this.gameStop = null
    }

    private async handleSinglePlayer(event: CustomEvent) {
        alert('coming soon')
    }
}

async function getClientIP(timeoutMs: number = 1000): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response: Response = await fetch('https://api.ipify.org?format=json', {
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: { ip: string } = await response.json();
        return data.ip;
    } catch (error) {
        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                console.error('Request timed out');
            } else {
                console.error('Error fetching IP:', error.message);
            }
        } else {
            console.error('An unknown error occurred');
        }
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Initialize the client when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new Client().initialize();
});

document.body.style.backgroundImage = `url(${backgroundImage})`;

function setFavicon(): void {
    const link = document.createElement('link');
    link.type = 'image/x-icon';
    link.rel = 'shortcut icon';
    link.href = favicon;
    document.head.appendChild(link);
}