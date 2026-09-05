import Peer from '../../../../../remote-site/vendor/peerjs.min.js';

// The source is workspace-owned in remote-site/vendor and is consumed by both
// endpoints. It is an MIT-derived PeerJS 1.5.5 data-only fork: the PeerJS
// signaling/WebRTC ABI stays opaque while MediaConnection, binary/raw codecs,
// and global exports are absent.
export default Peer;
