const TITLE = '高速公路作业区布置系统';
const PATH = '/pages/index/index';
const TIMELINE_QUERY = 'from=share';
const FRIEND_IMAGE = '/assets/share-friend.png';
const TIMELINE_IMAGE = '/assets/icon-cone.png';

function enableShareMenu() {
  if (!wx.showShareMenu) return;
  wx.showShareMenu({
    withShareTicket: true,
    menus: ['shareAppMessage', 'shareTimeline'],
  });
}

function shareToFriend() {
  return { title: TITLE, path: PATH, imageUrl: FRIEND_IMAGE };
}

function shareToTimeline() {
  return { title: TITLE, query: TIMELINE_QUERY, imageUrl: TIMELINE_IMAGE };
}

function isShareEntry(options) {
  return !!(options && options.from === 'share');
}

module.exports = {
  TITLE,
  PATH,
  TIMELINE_QUERY,
  enableShareMenu,
  shareToFriend,
  shareToTimeline,
  isShareEntry,
};
