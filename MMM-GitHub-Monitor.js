Module.register('MMM-GitHub-Monitor', {
  defaults: {
    accessToken: '',
    updateInterval: 1000 * 60 * 5,
    maxPullRequestTitleLength: 80,
    maxItems: 10,
    showChecks: true,
    showReviews: true,
    staleWarningDays: 3,
    staleDangerDays: 7,
    showLabels: true,
    showComments: true,
    repositories: [],
    baseURL: 'https://api.github.com',
  },

  getStyles: function () {
    return [
      this.file('MMM-GitHub-Monitor.css'),
      'font-awesome.css'
    ];
  },

  start: function () {
    Log.log('Starting module: ' + this.name);
    this.pulls = [];
    this.loaded = false;

    if (this.config.accessToken) {
      this.sendSocketNotification('FETCH_GITHUB_DATA', this.config);
      var self = this;
      setInterval(function () {
        self.sendSocketNotification('FETCH_GITHUB_DATA', self.config);
      }, this.config.updateInterval);
      // Refresh relative timestamps every 30s
      setInterval(function () {
        self.refreshTimes();
      }, 30000);
    }
  },

  getHeader: function () {
    return '<i class="fa fa-github"></i> ' + (this.data.header || 'Pull Requests');
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === 'GITHUB_DATA_RESULT') {
      if (!this.loaded) {
        this.pulls = payload;
        this.loaded = true;
        this.updateDom(0);
      } else {
        this.applyUpdate(payload);
      }
    }
  },

  // Build a unique key for a PR
  pullKey: function (pull) {
    return pull.repo + '#' + pull.number;
  },

  applyUpdate: function (newPulls) {
    var container = document.querySelector('.MMM-GitHub-Monitor .gh-pr-list');
    if (!container) {
      this.pulls = newPulls;
      this.updateDom(0);
      return;
    }

    var oldKeys = {};
    for (var i = 0; i < this.pulls.length; i++) {
      oldKeys[this.pullKey(this.pulls[i])] = true;
    }
    var newKeys = {};
    for (var j = 0; j < newPulls.length; j++) {
      newKeys[this.pullKey(newPulls[j])] = true;
    }

    // Remove PRs no longer in the list
    var existing = container.querySelectorAll('.gh-pr-item');
    for (var k = existing.length - 1; k >= 0; k--) {
      var key = existing[k].dataset.prKey;
      if (!newKeys[key]) {
        existing[k].remove();
      }
    }

    // Insert new PRs at the correct position
    for (var m = 0; m < newPulls.length; m++) {
      var prKey = this.pullKey(newPulls[m]);
      if (!oldKeys[prKey]) {
        var el = this.buildPullEl(newPulls[m], true);
        var existingItems = container.querySelectorAll('.gh-pr-item');
        if (m < existingItems.length) {
          container.insertBefore(el, existingItems[m]);
        } else {
          container.appendChild(el);
        }
      }
    }

    this.pulls = newPulls;
    this.applyFade(container);
  },

  applyFade: function (container) {
    var items = container.querySelectorAll('.gh-pr-item');
    var total = items.length;
    var fadeStart = total * 0.75;
    for (var i = 0; i < total; i++) {
      items[i].style.opacity = i >= fadeStart ? 1 - ((i - fadeStart) / (total - fadeStart)) : '';
    }
  },

  refreshTimes: function () {
    var els = document.querySelectorAll('.MMM-GitHub-Monitor .gh-pr-time');
    for (var i = 0; i < els.length; i++) {
      var ts = els[i].dataset.timestamp;
      if (ts) {
        els[i].innerHTML = this.formatTime(ts);
      }
    }
  },

  getDom: function () {
    var wrapper = document.createElement('div');
    wrapper.className = 'gh-monitor-feed';

    if (!this.loaded) {
      wrapper.innerHTML = '<span class="dimmed light small">Loading PRs...</span>';
      return wrapper;
    }

    if (this.pulls.length === 0) {
      wrapper.innerHTML = '<span class="dimmed light small">No pull requests.</span>';
      return wrapper;
    }

    var list = document.createElement('div');
    list.className = 'gh-pr-list';

    for (var i = 0; i < this.pulls.length; i++) {
      var el = this.buildPullEl(this.pulls[i], false);
      // Apply fade to bottom 25%
      var fadeStart = this.pulls.length * 0.75;
      if (i >= fadeStart) {
        el.style.opacity = 1 - ((i - fadeStart) / (this.pulls.length - fadeStart));
      }
      list.appendChild(el);
    }

    wrapper.appendChild(list);
    return wrapper;
  },

  getAgeDays: function (isoString) {
    if (!isoString) return 0;
    return (Date.now() - new Date(isoString).getTime()) / 86400000;
  },

  buildPullEl: function (pull, isNew) {
    var item = document.createElement('div');
    item.className = 'gh-pr-item' + (isNew ? ' gh-pr-new' : '');
    item.dataset.prKey = this.pullKey(pull);

    // Age-based highlighting for open PRs
    if (pull.state === 'open') {
      var ageDays = this.getAgeDays(pull.created_at);
      if (ageDays >= this.config.staleDangerDays) {
        item.classList.add('gh-stale-danger');
      } else if (ageDays >= this.config.staleWarningDays) {
        item.classList.add('gh-stale-warning');
      }
    }

    // Title line with icon
    var titleLine = document.createElement('div');
    titleLine.className = 'gh-pr-title-line';

    var icon = document.createElement('span');
    icon.className = 'gh-pr-icon';
    if (pull.draft) {
      icon.innerHTML = '<i class="fa fa-pencil gh-draft"></i>';
    } else if (pull.merged) {
      icon.innerHTML = '<i class="fa fa-check-circle gh-merged"></i>';
    } else if (pull.state === 'open') {
      icon.innerHTML = '<i class="fa fa-code-fork gh-open"></i>';
    } else {
      icon.innerHTML = '<i class="fa fa-times-circle gh-closed"></i>';
    }
    titleLine.appendChild(icon);

    var title = document.createElement('span');
    title.className = 'bright';
    title.innerHTML = pull.title;
    titleLine.appendChild(title);

    // Inline badges: checks, review, comments
    var badges = document.createElement('span');
    badges.className = 'gh-pr-badges';

    if (this.config.showChecks && pull.checksStatus) {
      var checkIcon = document.createElement('span');
      checkIcon.className = 'gh-badge';
      if (pull.checksStatus === 'success') {
        checkIcon.innerHTML = '<i class="fa fa-check gh-ci-pass"></i>';
      } else if (pull.checksStatus === 'failure') {
        checkIcon.innerHTML = '<i class="fa fa-times gh-ci-fail"></i>';
      } else {
        checkIcon.innerHTML = '<i class="fa fa-circle-o-notch gh-ci-pending"></i>';
      }
      badges.appendChild(checkIcon);
    }

    if (this.config.showReviews && pull.reviewStatus && pull.reviewStatus !== 'pending') {
      var reviewIcon = document.createElement('span');
      reviewIcon.className = 'gh-badge';
      if (pull.reviewStatus === 'approved') {
        reviewIcon.innerHTML = '<i class="fa fa-thumbs-up gh-review-approved"></i>';
      } else {
        reviewIcon.innerHTML = '<i class="fa fa-thumbs-down gh-review-changes"></i>';
      }
      badges.appendChild(reviewIcon);
    }

    if (this.config.showComments && pull.comments > 0) {
      var commentBadge = document.createElement('span');
      commentBadge.className = 'gh-badge gh-comments';
      commentBadge.innerHTML = '<i class="fa fa-comment-o"></i> ' + pull.comments;
      badges.appendChild(commentBadge);
    }

    titleLine.appendChild(badges);
    item.appendChild(titleLine);

    // Label pills
    if (this.config.showLabels && pull.labels && pull.labels.length > 0) {
      var labelsLine = document.createElement('div');
      labelsLine.className = 'gh-pr-labels';
      pull.labels.forEach(function (label) {
        var pill = document.createElement('span');
        pill.className = 'gh-label';
        pill.style.backgroundColor = '#' + label.color;
        pill.style.color = parseInt(label.color, 16) > 0x7fffff ? '#000' : '#fff';
        pill.innerHTML = label.name;
        labelsLine.appendChild(pill);
      });
      item.appendChild(labelsLine);
    }

    // Meta line
    var meta = document.createElement('div');
    meta.className = 'gh-pr-meta xsmall dimmed';
    var authorHtml = '';
    if (pull.avatar) {
      authorHtml = '<img class="gh-avatar" src="' + pull.avatar + '&s=32" /> ';
    }
    authorHtml += pull.author;
    var metaParts = [pull.repo, authorHtml];
    var timeValue;
    if (pull.merged && pull.base) {
      metaParts.push('<i class="fa fa-arrow-right"></i> ' + pull.base);
      timeValue = pull.merged_at;
    } else {
      timeValue = pull.created_at;
    }
    var timeSpan = '<span class="gh-pr-time" data-timestamp="' + timeValue + '">' + this.formatTime(timeValue) + '</span>';
    metaParts.push(timeSpan);

    // Stale age indicator
    if (pull.state === 'open') {
      var staleAgeDays = Math.floor(this.getAgeDays(pull.created_at));
      if (staleAgeDays >= this.config.staleWarningDays) {
        var ageClass = staleAgeDays >= this.config.staleDangerDays ? 'gh-age-danger' : 'gh-age-warning';
        metaParts.push('<span class="' + ageClass + '">' + staleAgeDays + 'd old</span>');
      }
    }

    meta.innerHTML = metaParts.join(' · ');
    item.appendChild(meta);

    return item;
  },

  formatTime: function (isoString) {
    if (!isoString) return '';
    var now = Date.now();
    var then = new Date(isoString).getTime();
    var diffMin = Math.floor((now - then) / 60000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return diffMin + ' min ago';
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + ' hr ago';
    var diffDay = Math.floor(diffHr / 24);
    return diffDay + ' day' + (diffDay > 1 ? 's' : '') + ' ago';
  },
});
