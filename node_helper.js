const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
  start: function () {
    this.cache = null;
    this.cacheExpiry = 0;
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "FETCH_GITHUB_DATA") {
      this.fetchData(payload);
    }
  },

  fetchData: async function (config) {
    // Return cached data if still valid
    if (this.cache && Date.now() < this.cacheExpiry) {
      this.sendSocketNotification("GITHUB_DATA_RESULT", this.cache);
      return;
    }

    var headers = {
      Accept: "application/vnd.github+json",
    };
    if (config.accessToken) {
      headers.Authorization = "Bearer " + config.accessToken;
    }

    var allPulls = [];

    for (var i = 0; i < config.repositories.length; i++) {
      var repo = config.repositories[i];
      try {
        var pulls = await this.fetchRepoPulls(config.baseURL, repo, headers, config.maxPullRequestTitleLength);
        allPulls = allPulls.concat(pulls);
      } catch (err) {
        console.error("[MMM-GitHub-Monitor] Error fetching " + repo.owner + "/" + repo.name + ": " + err.message);
      }
    }

    // Sort all PRs by most recent activity (merged or created) descending
    allPulls.sort(function (a, b) {
      return new Date(b.sort_time) - new Date(a.sort_time);
    });

    // Limit to maxItems
    if (config.maxItems) {
      allPulls = allPulls.slice(0, config.maxItems);
    }

    // Enrich visible open PRs with review and CI status
    if (config.accessToken) {
      await this.enrichPulls(allPulls, config.baseURL, headers);
    }

    this.cache = allPulls;
    this.cacheExpiry = Date.now() + (config.updateInterval || 300000);
    this.sendSocketNotification("GITHUB_DATA_RESULT", allPulls);
  },

  fetchRepoPulls: async function (baseURL, repo, headers, maxTitleLength) {
    var pulls = [];
    var repoFullName = repo.owner + "/" + repo.name;
    var repoName = repo.name;
    var perPage = repo.pulls.loadCount || 10;

    // Fetch open PRs
    var resOpen = await fetch(
      baseURL + "/repos/" + repoFullName +
      "/pulls?state=open&sort=created&direction=desc&per_page=" + perPage,
      { headers: headers }
    );
    if (resOpen.ok) {
      var openPulls = await resOpen.json();
      pulls = pulls.concat(this.mapPulls(openPulls, repoFullName, repoName, maxTitleLength));
    }

    // Fetch recently closed/merged PRs
    var resClosed = await fetch(
      baseURL + "/repos/" + repoFullName +
      "/pulls?state=closed&sort=updated&direction=desc&per_page=" + perPage,
      { headers: headers }
    );
    if (resClosed.ok) {
      var closedPulls = await resClosed.json();
      pulls = pulls.concat(this.mapPulls(closedPulls, repoFullName, repoName, maxTitleLength));
    }

    return pulls;
  },

  enrichPulls: async function (pulls, baseURL, headers) {
    var openPulls = pulls.filter(function (p) { return p.state === "open"; });
    await Promise.all(openPulls.map(async function (pull) {
      try {
        // Review status
        var resReviews = await fetch(
          baseURL + "/repos/" + pull.repoFullName + "/pulls/" + pull.number + "/reviews",
          { headers: headers }
        );
        if (resReviews.ok) {
          var reviews = await resReviews.json();
          var latestByUser = {};
          reviews.forEach(function (r) {
            if (r.state !== "COMMENTED" && r.state !== "PENDING") {
              latestByUser[r.user.login] = r.state;
            }
          });
          var states = Object.values(latestByUser);
          if (states.indexOf("CHANGES_REQUESTED") >= 0) {
            pull.reviewStatus = "changes_requested";
          } else if (states.indexOf("APPROVED") >= 0) {
            pull.reviewStatus = "approved";
          } else {
            pull.reviewStatus = "pending";
          }
        }

        // CI checks status
        if (pull.headSha) {
          var resChecks = await fetch(
            baseURL + "/repos/" + pull.repoFullName + "/commits/" + pull.headSha + "/check-runs?per_page=100",
            { headers: headers }
          );
          if (resChecks.ok) {
            var checksData = await resChecks.json();
            var runs = checksData.check_runs || [];
            if (runs.length > 0) {
              var hasFailure = runs.some(function (r) { return r.conclusion === "failure" || r.conclusion === "timed_out"; });
              var hasPending = runs.some(function (r) { return r.status !== "completed"; });
              if (hasFailure) pull.checksStatus = "failure";
              else if (hasPending) pull.checksStatus = "pending";
              else pull.checksStatus = "success";
            }
          }
        }
      } catch (_) { /* skip enrichment errors */ }
    }));
  },

  mapPulls: function (jsonPulls, repoFullName, repoName, maxTitleLength) {
    return jsonPulls.map(function (pull) {
      var title = pull.title;
      if (maxTitleLength && title.length > maxTitleLength) {
        title = title.substr(0, maxTitleLength) + "...";
      }
      return {
        number: pull.number,
        title: title,
        repo: repoName,
        author: pull.user ? pull.user.login : "unknown",
        avatar: pull.user ? pull.user.avatar_url : null,
        state: pull.state,
        draft: pull.draft || false,
        comments: (pull.comments || 0) + (pull.review_comments || 0),
        labels: (pull.labels || []).map(function (l) { return { name: l.name, color: l.color }; }),
        merged: pull.merged_at !== null,
        merged_at: pull.merged_at,
        base: pull.base ? pull.base.ref : null,
        headSha: pull.head ? pull.head.sha : null,
        created_at: pull.created_at,
        updated_at: pull.updated_at,
        repoFullName: repoFullName,
        reviewStatus: null,
        checksStatus: null,
        // Sort key: use merged_at for merged PRs, created_at for open
        sort_time: pull.merged_at || pull.created_at,
      };
    });
  },
});
