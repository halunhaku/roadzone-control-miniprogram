const { enableShareMenu } = require('./utils/share');

App({
  onLaunch() {
    enableShareMenu();
  },
});

