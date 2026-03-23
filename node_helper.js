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

    var results = [];

    for (var i = 0; i < config.repositories.length; i++) {
      var repo = config.repositories[i];
      try {
        var repoData = await this.fetchRepo(config.baseURL, repo, headers, i, config.maxPullRequestTitleLength);
        if (repoData) {
          results.push(repoData);
        }
      } catch (err) {
        console.error("[MMM-GitHub-Monitor] Error fetching " + repo.owner + "/" + repo.name + ": " + err.message);
      }
    }

    if (config.sort) {
      results.sort(function (r1, r2) {
        return r1.title.localeCompare(r2.title);
      });
    }

    this.cache = results;
    this.cacheExpiry = Date.now() + (config.updateInterval || 600000);
    this.sendSocketNotification("GITHUB_DATA_RESULT", results);
  },

  fetchRepo: async function (baseURL, repo, headers, id, maxTitleLength) {
    var resBase = await fetch(baseURL + "/repos/" + repo.owner + "/" + repo.name, { headers: headers });
    if (!resBase.ok) return null;

    var jsonBase = await resBase.json();
    var repoData = {
      id: id,
      title: repo.owner + "/" + repo.name,
      stars: jsonBase.stargazers_count,
      forks: jsonBase.forks_count,
    };

    if (repo.pulls && repo.pulls.display) {
      var params = [];
      var pullsConfig = {
        state: repo.pulls.state || "open",
        head: repo.pulls.head,
        base: repo.pulls.base,
        sort: repo.pulls.sort || "created",
        direction: repo.pulls.direction || "desc",
      };
      Object.keys(pullsConfig).forEach(function (key) {
        if (pullsConfig[key]) {
          params.push(key + "=" + pullsConfig[key]);
        }
      });

      var resPulls = await fetch(
        baseURL + "/repos/" + repo.owner + "/" + repo.name + "/pulls?" + params.join("&"),
        { headers: headers }
      );
      if (resPulls.ok) {
        var jsonPulls = await resPulls.json();
        if (repo.pulls.loadCount) {
          jsonPulls = jsonPulls.slice(0, repo.pulls.loadCount);
        }
        if (maxTitleLength) {
          jsonPulls.forEach(function (pull) {
            if (pull.title.length > maxTitleLength) {
              pull.title = pull.title.substr(0, maxTitleLength) + "...";
            }
          });
        }
        repoData.step = Math.min(repo.pulls.displayCount || jsonPulls.length, jsonPulls.length);
        repoData.pulls = jsonPulls;
      }
    }

    return repoData;
  },
});
